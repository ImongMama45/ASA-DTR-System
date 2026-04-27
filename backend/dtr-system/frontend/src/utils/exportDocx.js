import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  BorderStyle,
  WidthType,
  VerticalAlign,
  PageOrientation,
} from 'docx';
import { saveAs } from 'file-saver';
import { MONTH_NAMES } from './dateUtils';

// ─── Constants (all in DXA) ──────────────────────────────────────────────────
const MARGIN = 360; // 0.25"
const COL_GAP = 720; // 0.5" gap between 3 columns
const STRIP_W = 4560; // (15840 − 360*2 − 720*2) / 3

// Time-table column widths (must sum to STRIP_W = 4560)
const TC = [447, 657, 774, 715, 715, 715, 537];

// ─── Border presets ──────────────────────────────────────────────────────────
const bNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF', space: 0 };
const bLine = { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 0 };
const bBold = { style: BorderStyle.SINGLE, size: 10, color: '000000', space: 0 };

const BORDER_ALL = { top: bLine, bottom: bLine, left: bLine, right: bLine };
const BORDER_NONE = { top: bNone, bottom: bNone, left: bNone, right: bNone };
const BORDER_BOT = { top: bNone, bottom: bLine, left: bNone, right: bNone };
const BORDER_CENTER = { top: bNone, bottom: bLine, left: bNone, right: bNone };
const BORDER_TOP = { top: bLine, bottom: bNone, left: bNone, right: bNone };

// ─── Text helper ─────────────────────────────────────────────────────────────
function formatCivilianTime(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;

  let hours = Number(match[1]);
  const minutes = match[2];
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${hours}:${minutes}`;
}

function tx(text, { bold = false, size = 16, italic = false } = {}) {
  return new TextRun({
    text: String(text ?? ''),
    font: 'Arial',
    size,
    bold,
    italics: italic,
  });
}

// ─── Paragraph helpers ───────────────────────────────────────────────────────
const mkP = (runs, align = AlignmentType.LEFT, spacing = {}) =>
  new Paragraph({
    alignment: align,
    spacing: { before: 0, after: 0, line: 240, ...spacing },
    children: Array.isArray(runs) ? runs : [runs],
  });

const cP = (runs, sp = {}) => mkP(runs, AlignmentType.CENTER, sp);
const lP = (runs, sp = {}) => mkP(runs, AlignmentType.LEFT, sp);
const rP = (runs, sp = {}) => mkP(runs, AlignmentType.RIGHT, sp);

// ─── Cell helper ─────────────────────────────────────────────────────────────
function mkCell(
  content,
  {
    borders = BORDER_ALL,
    width = undefined,
    span = undefined,
    rowSpan = undefined,
    vAlign = VerticalAlign.CENTER,
    margins = { top: 20, bottom: 20, left: 50, right: 50 },
  } = {}
) {
  return new TableCell({
    children: Array.isArray(content) ? content : [content],
    borders,
    width: width != null ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: span,
    rowSpan,
    verticalAlign: vAlign,
    margins,
  });
}

// ─── Build inner time table ──────────────────────────────────────────────────
function buildTimeTable(empData, batch) {
  const { month, year, cutoff } = batch;

  const ttBorders = (colIdx, { top = false, bottom = false } = {}) => ({
    top: top ? bLine : bNone,
    bottom: bottom ? bBold : bLine,
    left: bBold,
    right: colIdx === 0 || colIdx === 2 || colIdx === 4 ? bBold : bLine,
  });

  const hdr1 = new TableRow({
    tableHeader: true,
    children: [
      mkCell(cP([tx('Day', { bold: true, size: 15 })]), {
        width: TC[0],
        rowSpan: 2,
        vAlign: VerticalAlign.CENTER,
        borders: ttBorders(0, { top: true }),
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
      }),
      mkCell(cP([tx('A.M.', { bold: true, size: 15 })]), {
        span: 2,
        borders: ttBorders(1, { top: true }),
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
      }),
      mkCell(cP([tx('P.M.', { bold: true, size: 15 })]), {
        span: 2,
        borders: ttBorders(3, { top: true }),
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
      }),
      mkCell(cP([tx('Undertime', { bold: true, size: 15 })]), {
        span: 2,
        borders: ttBorders(5, { top: true }),
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
      }),
    ],
  });

  const subLabels = ['Arrival', 'Depar-\nture', 'Arrival', 'Depar-\nture', 'Hours', 'Min-\nutes'];
  const hdr2 = new TableRow({
    tableHeader: true,
    children: subLabels.map((lbl, i) =>
      mkCell(cP([tx(lbl, { bold: true, size: 14 })]), {
        width: TC[i + 1],
        borders: ttBorders(i + 1),
        margins: { top: 20, bottom: 20, left: 15, right: 15 },
      })
    ),
  });

  const weekendCell = (label) =>
    mkCell(cP([tx(label, { size: 16, italic: true })]), {
      margins: { top: 10, bottom: 10, left: 10, right: 10 },
    });

  const timeCell = (val, italic = false) =>
    mkCell(cP([tx(val || '', { size: 16, italic })]), {
      margins: { top: 10, bottom: 10, left: 10, right: 10 },
    });

  const monthDays = new Date(year, month, 0).getDate();
  const cutoffStart = cutoff === 1 ? 1 : 16;
  const cutoffEnd = cutoff === 1 ? 15 : monthDays;

  const dayRows = [];
  for (let day = 1; day <= 31; day++) {
    const inMonth = day <= monthDays;
    const inCutoff = day >= cutoffStart && day <= cutoffEnd;
    const row = empData.rows.find((r) => r.day === day) || {};
    const duty = (empData.emp.duty || 'AM').toUpperCase();

    let isWknd = false;
    let wLabel = '';
    let showAM = false;
    let showPM = false;

    if (inMonth && inCutoff) {
      const date = new Date(year, month - 1, day);
      const dow = date.getDay();
      isWknd = dow === 0 || dow === 6;
      wLabel = dow === 6 ? 'SAT' : 'SUN';
      showAM = isWknd && (duty === 'AM' || duty === 'WHOLE');
      showPM = isWknd && (duty === 'PM' || duty === 'WHOLE');
    }

    const amArrival = inMonth && inCutoff ? (isWknd ? '' : formatCivilianTime(row.arrival || '')) : '';
    const amDeparture = inMonth && inCutoff ? (isWknd ? '' : formatCivilianTime(row.departure || '')) : '';
    const pmArrival = inMonth && inCutoff ? (isWknd ? '' : formatCivilianTime(row.pmArrival || '')) : '';
    const pmDeparture = inMonth && inCutoff ? (isWknd ? '' : formatCivilianTime(row.pmDeparture || '')) : '';

    dayRows.push(
      new TableRow({
        children: [
          mkCell(cP([tx(day, { bold: true, size: 16 })]), {
            width: TC[0],
            borders: ttBorders(0),
            margins: { top: 10, bottom: 10, left: 10, right: 10 },
          }),
          showAM
            ? mkCell(cP([tx(wLabel, { size: 16, italic: true })]), { borders: ttBorders(1), margins: { top: 10, bottom: 10, left: 10, right: 10 } })
            : mkCell(cP([tx(amArrival, { size: 16 })]), { borders: ttBorders(1), margins: { top: 10, bottom: 10, left: 10, right: 10 } }),
          showAM
            ? mkCell(cP([tx(wLabel, { size: 16, italic: true })]), { borders: ttBorders(2), margins: { top: 10, bottom: 10, left: 10, right: 10 } })
            : mkCell(cP([tx(amDeparture, { size: 16 })]), { borders: ttBorders(2), margins: { top: 10, bottom: 10, left: 10, right: 10 } }),
          showPM
            ? mkCell(cP([tx(wLabel, { size: 16, italic: true })]), { borders: ttBorders(3), margins: { top: 10, bottom: 10, left: 10, right: 10 } })
            : mkCell(cP([tx(pmArrival, { size: 16 })]), { borders: ttBorders(3), margins: { top: 10, bottom: 10, left: 10, right: 10 } }),
          showPM
            ? mkCell(cP([tx(wLabel, { size: 16, italic: true })]), { borders: ttBorders(4), margins: { top: 10, bottom: 10, left: 10, right: 10 } })
            : mkCell(cP([tx(pmDeparture, { size: 16 })]), { borders: ttBorders(4), margins: { top: 10, bottom: 10, left: 10, right: 10 } }),
          mkCell(cP([tx('', { size: 16 })]), { borders: ttBorders(5), margins: { top: 10, bottom: 10, left: 10, right: 10 } }),
          mkCell(cP([tx('', { size: 16 })]), { borders: ttBorders(6), margins: { top: 10, bottom: 10, left: 10, right: 10 } }),
        ],
      })
    );
  }

  const totalRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 5,
        children: [rP([tx('Total', { bold: true, size: 16 })])],
        borders: { top: bLine, bottom: bLine, left: bLine, right: bNone },
        margins: { top: 20, bottom: 20, left: 40, right: 80 },
      }),
      mkCell(cP([tx('')]), { margins: { top: 20, bottom: 20, left: 10, right: 10 } }),
      mkCell(cP([tx('')]), { margins: { top: 20, bottom: 20, left: 10, right: 10 } }),
    ],
  });

  return new Table({
    width: { size: STRIP_W, type: WidthType.DXA },
    columnWidths: TC,
    rows: [hdr1, hdr2, ...dayRows, totalRow],
  });
}

// ─── Build one full strip ────────────────────────────────────────────────────
function buildStrip(empData, batch) {
  const { month, year, cutoff } = batch;
  const monthLabel = `${MONTH_NAMES[month - 1]} ${cutoff === 1 ? '1-15' : '16-31'}, ${year}`;

  const nameTable = new Table({
    width: { size: STRIP_W, type: WidthType.DXA },
    columnWidths: [STRIP_W],
    rows: [
      new TableRow({
        children: [
          mkCell(cP([tx(empData.emp.name, { bold: true, size: 18 })]), {
            borders: BORDER_BOT,
            width: STRIP_W,
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
          }),
        ],
      }),
    ],
  });

  const lW = Math.round(STRIP_W * 0.44);
  const rW = STRIP_W - lW;
  const monthTable = new Table({
    width: { size: STRIP_W, type: WidthType.DXA },
    columnWidths: [lW, rW],
    rows: [
      new TableRow({
        children: [
          mkCell(lP([tx('For the month of ', { size: 16 , italic : true })]), {
            borders: BORDER_NONE,
            width: lW,
            margins: { top: 20, bottom: 0, left: 20, right: 20 },
          }),
          mkCell(cP([tx(monthLabel, { bold: true, size: 16 })]), {
            borders: BORDER_BOT,
            width: rW,
            margins: { top: 20, bottom: 0, left: 20, right: 20 },
          }),
        ],
      }),
    ],
  });

  const lhW = Math.round(STRIP_W * 0.45);
  const midW = Math.round(STRIP_W * 0.29);
  const rhW = STRIP_W - lhW - midW;
  const offHoursTable = new Table({
    width: { size: STRIP_W, type: WidthType.DXA },
    columnWidths: [lhW, midW, rhW],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            rowSpan: 2,
            children: [cP([tx('Official hours for arrival and departure', { size: 15, italic: true })])],
            borders: BORDER_NONE,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 20, bottom: 20, left: 20, right: 30 },
          }),
          mkCell(lP([tx('Regular days', { size: 16 })]), {
            borders: BORDER_NONE,
            width: midW,
            vAlign: VerticalAlign.BOTTOM,
            margins: { top: 20, bottom: 0, left: 20, right: 10 },
          }),
          mkCell(cP([tx('')]), {
            borders: BORDER_BOT,
            width: rhW,
            margins: { top: 20, bottom: 0, left: 10, right: 20 },
          }),
        ],
      }),
      new TableRow({
        children: [
          mkCell(lP([tx('Saturdays', { size: 16 })]), {
            borders: BORDER_NONE,
            width: midW,
            vAlign: VerticalAlign.TOP,
            margins: { top: 0, bottom: 20, left: 20, right: 10 },
          }),
          mkCell(cP([tx('')]), {
            borders: BORDER_BOT,
            width: rhW,
            margins: { top: 0, bottom: 20, left: 10, right: 20 },
          }),
        ],
      }),
    ],
  });

  const certText =
    'I certify on my honor that the above is a true and correct report of the hours of work ' +
    'performed, record of which was made daily at the time of arrival and departure from office.';

  const empSigTable = new Table({
    width: { size: STRIP_W, type: WidthType.DXA },
    columnWidths: [STRIP_W],
    rows: [
      new TableRow({
        children: [
          mkCell(cP([tx(empData.emp.name, { bold: false, size: 14 })]), {
            borders: BORDER_BOT,
            width: STRIP_W,
            margins: { top: 60, bottom: 20, left: 80, right: 80 },
          }),
        ],
      }),
    ],
  });

  const verSigTable = new Table({
    width:        { size: STRIP_W, type: WidthType.DXA },
    columnWidths: [STRIP_W],
    rows: [
      // Blank row = space for handwritten signature, with a bottom line
      new TableRow({
        height: { value: 400, rule: 'exact' },
        children: [
          mkCell(
             cP([tx('ALYSSA MARIE L. MIJARES', { bold: true, size: 18 })])
            , 
            {
            borders: BORDER_BOT,
            width:   STRIP_W,
            margins: { top: 0, bottom: 0, left: 80, right: 80 },
          }),
        ],
      }),
      // Name row
      new TableRow({
        children: [
          mkCell(
              cP([tx('Acting College Administrator', { italic: true, size: 16 })]),
            {
              borders: BORDER_NONE,
              width:   STRIP_W,
              margins: { top: 0, bottom: 0, left: 80, right: 80 },
            }
          ),
        ],
      }),
    ],
  });

  return [
    lP([tx('Civil Service Form No. 48', { size: 15, italic: true })]),
    cP([tx('DAILY TIME RECORD', { bold: true, size: 24 })], { before: 20 }),
    cP([tx('-----o0o-----', { size: 16 })]),
    lP([tx('')]),
    nameTable,
    cP([tx('(Name)', { size: 14, italic: true })]),
    monthTable,
    offHoursTable,
    lP([tx('')]),
    buildTimeTable(empData, batch),
    lP([tx(certText, { size: 15, italic: true })], 
    { before: 60 }),
    lP([tx('')]),
    empSigTable,
    lP([tx('VERIFIED as to the prescribed office hours:', { size: 15, italic: true })], { before: 50 }),
    verSigTable,
    lP([tx('')]),
  ];
}

// ─── Public export function ──────────────────────────────────────────────────
export async function exportToDocx(batch) {
  const sections = batch.employees.map((empData) => {
    const strip1 = buildStrip(empData, batch);
    const strip2 = buildStrip(empData, batch);
    const strip3 = buildStrip(empData, batch);

    const colBreak = new Paragraph({
      children: [new TextRun({ break: 'column' })],
      spacing: { before: 0, after: 0 },
    });

    return {
      properties: {
        page: {
          size: {
            width: 12240,
            height: 15840,
            orientation: PageOrientation.LANDSCAPE,
          },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
        column: {
          count: 3,
          space: COL_GAP,
          equalWidth: true,
        },
      },
      children: [...strip1, colBreak, ...strip2, colBreak, ...strip3],
    };
  });

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 16 } },
      },
    },
    sections,
  });

  const blob = await Packer.toBlob(doc);
  const label = `${MONTH_NAMES[batch.month - 1]}_${batch.cutoff === 1 ? '1-15' : '16-31'}_${batch.year}`;
  saveAs(blob, `DTR_${label}.docx`);
}
