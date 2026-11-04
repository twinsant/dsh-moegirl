/**
 * Today's spend as the host reports it.
 *
 * The host half folds the account balance into a daily figure and serves it on
 * `/moegirl/spend`; this keeps the last answer so the bubble can render without
 * a request per frame. A failed poll keeps the previous number: a transient
 * network error is not a reason to blank a readout.
 * @module dsh-moegirl/client/spend-source
 */

import { SPEND_PATH } from '../pack-api.ts'

/** One reading of the daily spend. Mirrors the host snapshot. */
export interface SpendView {
  /** Local day the figure belongs to. */
  readonly date: string
  /** Money spent today. */
  readonly spent: number
  /** Wallet currency. */
  readonly currency: string
  /** Total currently available, when the host could read it. */
  readonly balance: number | null
  /** Epoch milliseconds behind the reading. */
  readonly updatedAt: number | null
  /** False while signed out or after a failed query. */
  readonly available: boolean
  /**
   * True while DeepSeek bills at off-peak (half) rates.
   *
   * Optional on purpose: the host half is whatever build the running process
   * loaded, while this bundle is re-read from disk on every page load, so the
   * two can legitimately disagree for a while. An absent value means "not
   * reported", never "off-peak".
   */
  readonly offPeak?: boolean
  /** Epoch milliseconds of the next rate switch, when the host reported one. */
  readonly nextSwitchAt?: number
}

let current: SpendView | undefined
const listeners = new Set<() => void>()

/** Latest reading, or undefined before the first successful poll. */
export function currentSpend(): SpendView | undefined {
  return current
}

/**
 * Subscribe to readings.
 * @param listener - called after a reading that differs from the previous one.
 * @returns unsubscribe.
 */
export function subscribeSpend(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Identity of the fields the bubble draws. `updatedAt` moves on every poll and
 * must not churn a re-render, so it is excluded.
 */
function signatureOf(view: SpendView | undefined): string {
  if (view === undefined) return ''
  return [
    view.date,
    view.spent,
    view.currency,
    view.balance === null ? '' : view.balance,
    view.available ? 1 : 0,
    view.offPeak ? 1 : 0,
    view.nextSwitchAt ?? '',
  ].join('|')
}

/** Publish a reading when the rendered fields changed. */
function publish(next: SpendView | undefined): void {
  if (signatureOf(next) === signatureOf(current)) return
  current = next
  for (const listener of [...listeners]) listener()
}

/**
 * Read one snapshot from the host.
 * @param signal - abort for the request.
 */
export async function refreshSpend(signal?: AbortSignal): Promise<void> {
  try {
    const response = await fetch(SPEND_PATH, { signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    publish(await response.json() as SpendView)
  } catch {
    // Keep the last figure; the next poll retries.
  }
}

/**
 * Poll the host on an interval.
 * @param intervalMs - poll period.
 * @param signal - abort stops polling.
 * @returns an explicit stop function, for a fiber that is disposed by other means.
 */
export function startSpendPolling(intervalMs: number, signal: AbortSignal): () => void {
  const tick = (): void => { void refreshSpend(signal) }
  tick()
  const timer = setInterval(tick, intervalMs)
  signal.addEventListener('abort', () => { clearInterval(timer) }, { once: true })
  return () => { clearInterval(timer) }
}
