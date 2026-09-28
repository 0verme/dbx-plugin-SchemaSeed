const SECOND_NS = 1_000_000_000n;
const MILLISECOND_NS = 1_000_000n;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))?$/u;

/** Parse a strict YYYY-MM-DD calendar value into UTC-encoded milliseconds. */
export function parseDate(value) {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime()
    : null;
}

/** Format a UTC-encoded calendar day without adding a time or timezone. */
export function formatDate(epochMilliseconds) {
  if (!Number.isFinite(epochMilliseconds)) throw new RangeError("Date value must be finite");
  return new Date(epochMilliseconds).toISOString().slice(0, 10);
}

/**
 * Parse a temporal literal without conflating a wall-clock timestamp with an instant.
 * timezoneAware=true requires Z or a numeric offset and normalizes to UTC nanoseconds;
 * timezoneAware=false accepts only an offset-free local timestamp.
 * @param {unknown} value
 * @param {{ timezoneAware?: boolean }} [options]
 * @returns {{ nanoseconds: bigint, precision: number } | null}
 */
export function parseTimestamp(value, options = {}) {
  const timezoneAware = options.timezoneAware ?? true;
  if (typeof value !== "string" || typeof timezoneAware !== "boolean") return null;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match || parseDate(match[1]) === null) return null;

  const [, dateText, hourText, minuteText, secondText, fraction = "", zone, offsetSign, offsetHourText, offsetMinuteText] = match;
  if (timezoneAware !== (zone !== undefined)) return null;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone && zone !== "Z") {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (offsetSign === "+" ? 1 : -1);
  }

  const milliseconds = parseDate(dateText);
  const dayNanoseconds = BigInt(milliseconds) * MILLISECOND_NS;
  const timeNanoseconds = BigInt(hour * 3600 + minute * 60 + second) * SECOND_NS
    + BigInt(fraction.padEnd(9, "0") || "0");
  const offsetNanoseconds = BigInt(offsetMinutes * 60) * SECOND_NS;
  return {
    nanoseconds: dayNanoseconds + timeNanoseconds - offsetNanoseconds,
    precision: fraction.length,
  };
}

/**
 * Format a nanosecond timestamp as an explicit UTC instant or an offset-free wall-clock value.
 * The Date instance is only a calendar arithmetic helper; callers receive a string, never a Date.
 * @param {bigint} nanoseconds
 * @param {number} precision
 * @param {boolean} [timezoneAware]
 */
export function formatTimestamp(nanoseconds, precision, timezoneAware = true) {
  if (typeof nanoseconds !== "bigint" || !Number.isSafeInteger(precision) || precision < 0 || precision > 9
    || typeof timezoneAware !== "boolean") {
    throw new RangeError("Timestamp requires nanoseconds, fractional precision from 0 through 9, and a timezone-awareness flag");
  }
  let seconds = nanoseconds / SECOND_NS;
  let fractionValue = nanoseconds % SECOND_NS;
  if (fractionValue < 0n) {
    seconds -= 1n;
    fractionValue += SECOND_NS;
  }
  const base = new Date(Number(seconds * 1_000n)).toISOString().replace(/\.\d{3}Z$/u, "");
  const localBase = timezoneAware ? base : base.replace("T", " ");
  if (precision === 0) return timezoneAware ? `${localBase}Z` : localBase;
  const fraction = fractionValue.toString().padStart(9, "0").slice(0, precision);
  return timezoneAware ? `${localBase}.${fraction}Z` : `${localBase}.${fraction}`;
}
