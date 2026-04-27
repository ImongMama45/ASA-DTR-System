export const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

export const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function getDatesInCutoff(year, month, cutoff) {
  const start = cutoff === 1 ? 1 : 16;
  const end = cutoff === 1 ? 15 : daysInMonth(year, month);
  const dates = [];
  for (let d = start; d <= end; d++) {
    dates.push(new Date(year, month - 1, d));
  }
  return dates;
}

export function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

export function isSaturday(date) { return date.getDay() === 6; }
export function isSunday(date)   { return date.getDay() === 0; }

export function getWeeks(dates) {
  const weeks = [];
  let current = [];
  dates.forEach(date => {
    const dow = date.getDay();
    if (dow === 1 && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(date);
  });
  if (current.length > 0) weeks.push(current);
  return weeks;
}

export function getWeekIndex(date, weeks) {
  return weeks.findIndex(w =>
    w.some(d => d.getTime() === date.getTime())
  );
}

export function workdaysInWeek(week) {
  return week.filter(d => !isWeekend(d)).length;
}

export function fmt2(n) { return String(n).padStart(2, '0'); }

// ── PRNG helpers ──────────────────────────────────────────────────────────────
function seededRand(seed, offset = 0) {
  const x = Math.sin((seed + offset) * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function randInt(seed, offset, min, max) {
  return min + Math.floor(seededRand(seed, offset) * (max - min + 1));
}

function randMinExcluding(seed, baseOffset, min, max, excludeMin) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const m = randInt(seed, baseOffset + attempt * 31, min, max);
    if (m !== excludeMin) return m;
  }
  const f = excludeMin + 1 <= max ? excludeMin + 1 : excludeMin - 1;
  return Math.min(max, Math.max(min, f));
}

/**
 * Resolve the final Out time given a computed total minute value and a
 * floor/cap range, ensuring the Out minute differs from arrM.
 *
 * When the computed value falls below the floor, the hour is set to floorH
 * and the minute is randomized within [floorM, 59] — not locked to :floorM.
 */
function resolveOut(computedTotalMin, floorTotalMin, capTotalMin, arrM, seed, offsetBase) {
  const clamped = Math.max(computedTotalMin, floorTotalMin);
  const final   = Math.min(clamped, capTotalMin);

  const outH    = Math.floor(final / 60);
  const rawOutM = final % 60;

  // If we landed exactly on the floor boundary minute, randomize within the
  // same hour so the minute varies naturally and differs from arrM.
  let outM;
  if (final === floorTotalMin) {
    // Randomize minute in [floorM, 59] but exclude arrM
    const floorM = floorTotalMin % 60;
    outM = randMinExcluding(seed, offsetBase, floorM, 59, arrM);
  } else {
    outM = rawOutM !== arrM
      ? rawOutM
      : randMinExcluding(seed, offsetBase, 0, 59, arrM);
  }

  return { outH, outM };
}

/**
 * Generate a realistic time entry.
 *
 * Core rule: Out = In + hoursPerDay (required hours MUST be covered).
 * An optional 0-15 min overtime is added on top (~35% of days).
 * Out minute always differs from In minute.
 *
 * AM DUTY:
 *   In  : 7:00 – 7:59
 *   Out : In + hoursPerDay [+ overtime]  →  floor 12:30, cap 1:30 PM
 *
 * PM DUTY:
 *   In  : 12:30 – 1:00 PM
 *   Out : max(In + hoursPerDay [+ overtime], 5:00 PM)  →  cap 7:00 PM
 *         5 PM floor ensures the allotted hours are always met or exceeded.
 *
 * @param {'AM'|'PM'} duty
 * @param {number}    hoursPerDay  hours required this day
 * @param {number}    seed         deterministic seed
 */
export function generateTime(duty, hoursPerDay, seed) {
  if (!hoursPerDay || hoursPerDay <= 0) {
    return { arrival: '', departure: '', pmArrival: '', pmDeparture: '' };
  }

  const requiredMins = Math.round(hoursPerDay * 60);

  // Extra time: 0–30 min max, ~35% of days
  const hasOvertime  = seededRand(seed, 7) > 0.65;
  const overtimeMins = hasOvertime ? randInt(seed, 13, 0, 30) : 0;  // ← was 0–15

  if (duty === 'AM') {
    const requiredMins = Math.round(hoursPerDay * 60);

    // ✅ Work backwards: earliest In = 12:30 - requiredMins
    // This guarantees Out is never before 12:30
    const floorOutMin  = 12 * 60 + 30;   // 12:30 PM = 750 min
    const capOutMin    = 13 * 60 + 30;   // 1:30 PM  = 810 min

    const latestArrMin  = 7 * 60 + 59;   // 7:59 AM latest In
    const earliestArrMin = floorOutMin - requiredMins; // e.g. 3hrs → 9:30 earliest

    // Clamp: if required hours > 5.5hrs, earliest would go before 7:00 — floor at 7:00
    const arrFloor = Math.max(7 * 60, earliestArrMin);
    const arrCap   = Math.min(latestArrMin, floorOutMin - requiredMins + (30 * 60 / 60));
    // Ensure floor ≤ cap (safety)
    const safeArrCap = Math.max(arrFloor, Math.min(latestArrMin, floorOutMin - requiredMins));

    const arrTotalMin = randInt(seed, 1, arrFloor, Math.max(arrFloor, safeArrCap));
    const arrH = Math.floor(arrTotalMin / 60);
    const arrM = arrTotalMin % 60;

    // Extra time: 0–30 min, ~35% of days
    const hasOvertime  = seededRand(seed, 7) > 0.65;
    const overtimeMins = hasOvertime ? randInt(seed, 13, 0, 30) : 0;

    const computed = arrTotalMin + requiredMins + overtimeMins;
    const { outH: depH, outM: depM } = resolveOut(
      computed,
      floorOutMin,   // 12:30 hard floor for Out
      capOutMin,     // 1:30 hard cap for Out
      arrM, seed, 17
    );

    return {
      arrival:     `${arrH}:${fmt2(arrM)}`,
      departure:   `${depH}:${fmt2(depM)}`,
      pmArrival:   '',
      pmDeparture: '',
    };
  } else {
    // PM: In 12:30–1:00, Out min 5:00 PM, max 7:00 PM
    const arrTotalMin = randInt(seed, 2, 12 * 60 + 30, 13 * 60 + 13);
    const arrH = Math.floor(arrTotalMin / 60);
    const arrM = arrTotalMin % 60;

    const computed = arrTotalMin + requiredMins + overtimeMins;

    // Floor = max(computed, 5:00 PM) so required hours are always met
    const floorMin = Math.max(arrTotalMin + requiredMins, 17 * 60);
    const capMin   = 18 * 60;   // 7:00 PM cap

    const { outH: depH, outM: depM } = resolveOut(
      computed, floorMin, capMin, arrM, seed, 23
    );

    return {
      arrival:     '',
      departure:   '',
      pmArrival:   `${arrH}:${fmt2(arrM)}`,
      pmDeparture: `${depH}:${fmt2(depM)}`,
    };
  }
}

export function cutoffLabel(month, year, cutoff) {
  return `${MONTH_NAMES[month - 1]} ${cutoff === 1 ? '1-15' : '16-31'}, ${year}`;
}