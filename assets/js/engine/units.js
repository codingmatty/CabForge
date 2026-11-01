// Display units. Every length is stored in millimetres; this module only
// turns millimetres into text in the shop's units and reads typed text back.
//
// Inches show as fractions rounded to 1/8, 1/16 or 1/32 (or as decimals),
// and anything over 36" as feet and inches: 23 5/8", 4' 0 1/2".
// parseLen reads 23.5, 23 1/2, 23-1/2", 3/4, 4' 6", 4ft 6in, 600mm, 60cm.

export const MM_PER_IN = 25.4;
/** Inch precisions offered: a fraction denominator, or 0 for decimals. */
export const PRECISIONS = [8, 16, 32, 0];
/** Above this many inches a length shows as feet and inches. */
const FEET_ABOVE_IN = 36;

const cfg = { system: 'mm', precision: 32 };

/** Sets the display units: { system: 'mm' | 'in', precision: 8 | 16 | 32 | 0 }. */
export function setUnits({ system, precision } = {}) {
  cfg.system = system === 'in' ? 'in' : 'mm';
  cfg.precision = PRECISIONS.includes(precision) ? precision : 32;
}

export const unitsConfig = () => ({ ...cfg });
export const isImperial = () => cfg.system === 'in';
/** 'mm' or 'in', for headers like "Feed in/min". */
export const unitName = () => cfg.system;

/** Millimetres with no unit: 600, 1.5. */
export function fmtMm(v) {
  return Math.abs(v - Math.round(v)) < 0.05 ? v.toFixed(0) : v.toFixed(1);
}

/** Decimal inches, up to three places, no trailing zeros. */
function decimalInches(v) {
  return String(Math.round(v * 1000) / 1000);
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Inches (a non-negative number) as a whole number and a reduced fraction. */
function fractionInches(v, den) {
  let n = Math.round(v * den);
  const whole = Math.floor(n / den);
  n -= whole * den;
  if (!n) return String(whole);
  const g = gcd(n, den);
  const frac = `${n / g}/${den / g}`;
  return whole ? `${whole} ${frac}` : frac;
}

/** Inches as text in the given precision; over 36" as feet and inches. */
export function formatInches(inches, precision = cfg.precision, { feet = true } = {}) {
  const sign = inches < 0 ? '-' : '';
  let v = Math.abs(inches);
  const den = precision || 0;
  // Snap first, so 47.999 shows as 4' 0", not 3' 12".
  if (den) v = Math.round(v * den) / den;
  // A small value that would round to nothing shows as a decimal instead.
  const tiny = v === 0 && Math.abs(inches) > 0;
  const part = (x) => (den && !tiny ? fractionInches(x, den) : tiny ? String(Math.round(Math.abs(inches) * 10000) / 10000) : decimalInches(x));
  if (feet && v > FEET_ABOVE_IN) {
    const ft = Math.floor(v / 12);
    return `${sign}${ft}' ${part(v - ft * 12)}"`;
  }
  return `${sign}${part(v)}"`;
}

/** A length in the display units: "600" (mm) or 23 5/8" (inches). */
export function fmtLen(mm, opts) {
  return cfg.system === 'in' ? formatInches(mm / MM_PER_IN, cfg.precision, opts) : fmtMm(mm);
}

/** A length with its unit: "600 mm" or 23 5/8". */
export function fmtLenU(mm, opts) {
  return cfg.system === 'in' ? fmtLen(mm, opts) : `${fmtMm(mm)} mm`;
}

/** "600 × 300" or 23 5/8" × 4' 0". */
export function fmtSize(a, b) {
  return `${fmtLen(a)} × ${fmtLen(b)}`;
}

/** A rate given in mm/min as a number in the display units per minute. */
export function rateValue(mmPerMin) {
  return cfg.system === 'in' ? Math.round((mmPerMin / MM_PER_IN) * 100) / 100 : mmPerMin;
}

/** A rate typed in the display units per minute, back in mm/min. */
export function rateToMm(v) {
  return cfg.system === 'in' ? v * MM_PER_IN : v;
}

export const FT_PER_M = 1000 / MM_PER_IN / 12;
const FT2_PER_M2 = FT_PER_M * FT_PER_M;

/** A run length given in metres (edge banding, countertop): "12.3 m" or "40.4 ft". */
export function fmtRun(m, digits = 1) {
  return cfg.system === 'in' ? `${(m * FT_PER_M).toFixed(digits)} ft` : `${m.toFixed(digits)} m`;
}

/** An area given in m²: "1.23 m²" or "13.2 ft²". */
export function fmtArea(m2) {
  return cfg.system === 'in' ? `${(m2 * FT2_PER_M2).toFixed(1)} ft²` : `${m2.toFixed(2)} m²`;
}

/** A length in mm as a plain number for CSV: mm to 0.1, or decimal inches to 0.001. */
export function csvLen(mm, unit = cfg.system) {
  return unit === 'in' ? String(Math.round((mm / MM_PER_IN) * 1000) / 1000) : mm.toFixed(1);
}

// ---- parsing ---------------------------------------------------------------

/** "23", "23.5", ".5", "1/2", "23 1/2", "23-1/2" → number, or NaN. */
function parseMixed(s) {
  s = s.trim();
  if (s === '') return NaN;
  let m = s.match(/^(\d*\.?\d+)$/);
  if (m) return parseFloat(m[1]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[2] ? m[1] / m[2] : NaN;
  m = s.match(/^(\d+)(?:\s+|\s*-\s*)(\d+)\/(\d+)$/);
  if (m) return +m[3] ? +m[1] + m[2] / m[3] : NaN;
  return NaN;
}

/**
 * Reads a typed length and returns millimetres (NaN if it can't be read).
 * A number with no unit is in the display units (`unit` overrides).
 */
export function parseLen(text, unit = cfg.system) {
  let s = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[″“”]/g, '"')
    .replace(/[′‘’]/g, "'")
    .replace(/,/g, '');
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1).trim();
  }
  if (s === '') return NaN;

  // Metric with a unit.
  const metric = s.match(/^(\d*\.?\d+)\s*(mm|cm|m)$/);
  if (metric) return sign * parseFloat(metric[1]) * { mm: 1, cm: 10, m: 1000 }[metric[2]];

  // Feet, then optional inches: 4', 4' 6", 4'-6 1/2", 4ft 6in.
  const ft = s.match(/^(.*?)\s*(?:'|ft|feet|foot)(.*)$/);
  if (ft) {
    const feet = parseMixed(ft[1]);
    const rest = ft[2].replace(/^[\s-]+/, '').replace(/\s*(?:"|in|inch|inches)$/, '');
    const inches = rest === '' ? 0 : parseMixed(rest);
    return sign * (feet * 12 + inches) * MM_PER_IN;
  }

  // Inches with a unit.
  const inch = s.match(/^(.*?)\s*(?:"|in|inch|inches)$/);
  if (inch) return sign * parseMixed(inch[1]) * MM_PER_IN;

  // No unit: the display units.
  const v = parseMixed(s);
  return sign * (unit === 'in' ? v * MM_PER_IN : v);
}
