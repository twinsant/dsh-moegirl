/**
 * DeepSeek's peak/off-peak billing schedule.
 *
 * From the official pricing page: off-peak rates are half of peak rates. Peak
 * hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday, excluding
 * Chinese public holidays. Every other hour is off-peak, weekends and holidays
 * in full included.
 *
 * The two axes use different calendars on purpose: the hour windows are UTC,
 * while holidays are Chinese calendar days. Both peak windows (01:00-10:00 UTC)
 * land on the same Shanghai date as their UTC date, so reading the holiday from
 * the Shanghai date never straddles a boundary.
 *
 * The holiday table comes from the State Council's 2026 announcement and is
 * replaced each year; the plugin config can override it.
 * @module dsh-moegirl/off-peak
 */

/** Half-open UTC hour ranges billed at peak rates on weekdays. */
export const PEAK_HOURS_UTC: readonly (readonly [number, number])[] = [[1, 4], [6, 10]]

/**
 * 2026 Chinese public holidays as inclusive Asia/Shanghai date ranges.
 * Make-up working days (调休上班) stay weekends under the rate rule and need no
 * entry here.
 */
export const HOLIDAY_RANGES_2026: readonly (readonly [string, string])[] = [
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
]

/** Injected schedule; every field falls back to the published rule. */
export interface OffPeakSchedule {
  /** Half-open UTC hour ranges that are peak on weekdays. */
  readonly peakHoursUtc?: readonly (readonly [number, number])[]
  /** Inclusive Asia/Shanghai holiday date ranges, `YYYY-MM-DD`. */
  readonly holidayRanges?: readonly (readonly [string, string])[]
}

/** Result of one rate-period reading. */
export interface OffPeakState {
  /** True while off-peak rates apply. */
  readonly offPeak: boolean
  /** Epoch milliseconds of the next switch, absent when the clock is unavailable. */
  readonly nextSwitchAt?: number
}

const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Asia/Shanghai calendar date of an instant, `YYYY-MM-DD`. */
export function shanghaiDate(instant: Date): string {
  return SHANGHAI_DATE.format(instant)
}

/** Whether one Shanghai date falls inside any holiday range. */
function isHoliday(date: string, ranges: readonly (readonly [string, string])[]): boolean {
  for (const [from, to] of ranges) {
    if (date >= from && date <= to) return true
  }
  return false
}

/**
 * Whether one instant bills at peak rates.
 * @param instant - clock reading.
 * @param schedule - overrides for the published rule.
 * @returns peak flag plus the Shanghai holiday date it was decided against.
 */
function peakAt(instant: Date, schedule: OffPeakSchedule): boolean {
  const hours = schedule.peakHoursUtc ?? PEAK_HOURS_UTC
  const ranges = schedule.holidayRanges ?? HOLIDAY_RANGES_2026
  const day = instant.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = instant.getUTCHours()
  if (!hours.some(([from, to]) => hour >= from && hour < to)) return false
  return !isHoliday(shanghaiDate(instant), ranges)
}

/**
 * Read the rate period at one instant, plus when it next changes.
 *
 * The switch time comes from a forward scan rather than closed-form arithmetic:
 * a minute grid is exact to the minute the icon needs, and it keeps the holiday
 * and weekday logic in one place instead of duplicating it per boundary case.
 * @param instant - clock reading.
 * @param schedule - overrides for the published rule.
 * @returns the current period and the next boundary, up to a day ahead.
 */
export function offPeakAt(instant: Date, schedule: OffPeakSchedule = {}): OffPeakState {
  const offPeak = !peakAt(instant, schedule)
  const step = 60_000
  const start = Math.floor(instant.getTime() / step) * step
  for (let minutes = 1; minutes <= 24 * 60; minutes += 1) {
    const candidate = new Date(start + minutes * step)
    if (!peakAt(candidate, schedule) !== offPeak) {
      return { offPeak, nextSwitchAt: candidate.getTime() }
    }
  }
  return { offPeak }
}
