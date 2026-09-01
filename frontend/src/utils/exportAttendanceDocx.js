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
  ImageRun,
} from 'docx';
import { saveAs } from 'file-saver';
import { MONTH_NAMES } from './dateUtils';

// ─── Border presets ──────────────────────────────────────────────────────────
const bLine = { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 0 };
const BORDER_ALL = { top: bLine, bottom: bLine, left: bLine, right: bLine };

// ─── Text helper ─────────────────────────────────────────────────────────────
function tx(text, { bold = false, size = 16, italic = false, color = '000000' } = {}) {
  return new TextRun({
    text: String(text ?? ''),
    font: 'Times New Roman', // matching the screenshot font vibe
    size,
    bold,
    italics: italic,
    color,
  });
}

const mkP = (runs, align = AlignmentType.LEFT, spacing = {}) =>
  new Paragraph({
    alignment: align,
    spacing: { before: 0, after: 0, line: 240, ...spacing },
    children: Array.isArray(runs) ? runs : [runs],
  });

const cP = (runs, sp = {}) => mkP(runs, AlignmentType.CENTER, sp);

function mkCell(
  content,
  {
    borders = BORDER_ALL,
    width = undefined,
    rowSpan = undefined,
    vAlign = VerticalAlign.CENTER,
    margins = { top: 60, bottom: 60, left: 100, right: 100 },
  } = {}
) {
  return new TableCell({
    children: Array.isArray(content) ? content : [content],
    borders,
    width: width != null ? { size: width, type: WidthType.DXA } : undefined,
    rowSpan,
    verticalAlign: vAlign,
    margins,
  });
}

// ─── Fetch image as ArrayBuffer ───────────────────────────────────────────────
async function fetchImageBuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blob.arrayBuffer();
  } catch (e) {
    return null;
  }
}

// ─── Main Export Function ────────────────────────────────────────────────────
export async function exportAttendanceDocx(employees, formData) {
  const { meetingName, date, time, room } = formData;

  // 1. Group active employees by Office
  const activeEmps = employees.filter(e => e.is_active !== false && e.office);
  activeEmps.sort((a, b) => {
    const off = a.office.localeCompare(b.office);
    if (off !== 0) return off;
    return a.name.localeCompare(b.name);
  });

  const officesMap = {};
  activeEmps.forEach(emp => {
    if (!officesMap[emp.office]) officesMap[emp.office] = [];
    officesMap[emp.office].push(emp);
  });

  // 2. Fetch logos (soft fail if missing)
  const leftLogoBuf = await fetchImageBuffer('/dalubhasaan-logo.png');
  const rightLogoBuf = await fetchImageBuffer('/asa-logo.png');

  const headerRuns = [];
  if (leftLogoBuf) {
    headerRuns.push(new ImageRun({ data: leftLogoBuf, transformation: { width: 80, height: 80 } }));
  }
  headerRuns.push(tx('      DALUBHASAAN NG LUNGSOD NG LUCENA      ', { bold: true, size: 24 }));
  if (rightLogoBuf) {
    headerRuns.push(new ImageRun({ data: rightLogoBuf, transformation: { width: 80, height: 80 } }));
  }

  // 3. Construct Document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 1080, right: 1080 }, // 0.5" top/bot, 0.75" left/right
          },
        },
        children: [
          // Header
          cP(headerRuns, { before: 0, after: 100 }),
          cP(tx('(formerly City College of Lucena)', { italic: true, size: 20 }), { after: 100 }),
          cP(tx('Brgy. Isabang, Lucena City', { size: 20 }), { after: 300 }),
          cP(tx('ALLIANCE OF STUDENT ASSISTANTS', { size: 22 }), { after: 720 }),

          // Form details
          cP(tx(`ATTENDANCE: ${meetingName.toUpperCase()}`, { bold: true, size: 24 }), { after: 120 }),
          cP(tx(date, { italic: true, size: 20 }), { after: 120 }),
          cP(tx(`ROOM ${room}`, { italic: true, size: 20 }), { after: 120 }),
          cP(tx(time, { italic: true, size: 20 }), { after: 400 }),

          // Table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: buildTableRows(officesMap),
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBlob(doc);
  const safeName = meetingName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  saveAs(buffer, `Attendance_${safeName}.docx`);
}

function buildTableRows(officesMap) {
  const rows = [];
  
  // Header Row
  rows.push(
    new TableRow({
      tableHeader: true,
      children: [
        mkCell(cP(tx('#', { bold: true, size: 22 })), { width: 800 }),
        mkCell(cP(tx('OFFICE', { bold: true, size: 22 })), { width: 3000 }),
        mkCell(cP(tx('NAME', { bold: true, size: 22 })), { width: 4000 }),
        mkCell(cP(tx('SIGNATURE', { bold: true, size: 22 })), { width: 2200 }),
      ],
    })
  );

  let globalIndex = 1;

  for (const [office, emps] of Object.entries(officesMap)) {
    emps.forEach((emp, i) => {
      const isFirst = i === 0;
      
      const children = [
        mkCell(mkP(tx(`${globalIndex}.`, { size: 20 }))),
      ];

      // Add the OFFICE cell only for the first row of this office group (rowSpan)
      if (isFirst) {
        children.push(
          mkCell(mkP(tx(office, { bold: true, size: 20 })), { rowSpan: emps.length })
        );
      }

      // Add Name and Signature cells
      children.push(mkCell(mkP(tx(emp.name, { size: 20 }))));
      children.push(mkCell(mkP(tx('')))); // Empty signature cell

      rows.push(new TableRow({ children }));
      globalIndex++;
    });
  }

  return rows;
}
