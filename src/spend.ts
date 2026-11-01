/**
 * Today's spend, derived from the DeepSeek account balance.
 *
 * The Host exposes a balance rather than a spend figure, so this keeps a small
 * ledger beside the sprite packs. Each poll compares the platform total with
 * the previous reading and adds the drop to today's spend. A *rise* is a top-up
 * or a bonus landing, so it only moves the reference point instead of being
 * folded into the figure — which is why the accumulator is monotonic rather
 * than a difference between today's first and latest balance.
 *
 * Money is accumulated in cents so repeated small readings cannot drift.
 * @module dsh-moegirl/spend
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { offPeakAt, type OffPeakState } from './off-peak.ts'

/** One wallet row of the account balance answer. */
export interface AccountWalletLike {
  /** `CNY` or `USD`. */
  readonly currency: string
  /** Decimal string such as `"12.34"`. */
  readonly balance: string
}

/** Balance outcome the account service returns; `null` means signed out. */
export interface BalanceLike {
  /** `ready` carries wallets, `failed` does not. */
  readonly status: 'ready' | 'failed'
  /** Recharge wallets. */
  readonly value?: readonly AccountWalletLike[]
  /** Bonus wallets, spent separately from recharge money. */
  readonly bonusWallets?: readonly AccountWalletLike[]
}

/** Account service slice this plugin reads; typed structurally to stay independent. */
export interface AccountBalanceReader {
  /**
   * Query recharge and bonus wallet balances.
   * @param client - calling UI identity (version, locale, timezone).
   * @returns balance outcome, or null while signed out or when the grant changed.
   */
  getBalance(client: {
    readonly version: string
    readonly locale: string
    readonly timezoneOffsetSeconds: number
  }): Promise<BalanceLike | null>
}

/** What the sprite bubble renders. */
export interface SpendSnapshot {
  /** Local calendar day the figures belong to, `YYYY-MM-DD`. */
  readonly date: string
  /** Money spent today, in `currency`. */
  readonly spent: number
  /** Wallet currency the figures are expressed in. */
  readonly currency: string
  /** Total currently available across that currency's wallets, or null while unknown. */
  readonly balance: number | null
  /** Epoch milliseconds behind this reading. */
  readonly updatedAt: number | null
  /** False while the account is signed out or the last query failed. */
  readonly available: boolean
  /**
   * Why the last reading is unavailable, when it is. Kept on the snapshot so a
   * broken account binding is diagnosable from the route instead of only from
   * the host log.
   */
  readonly reason?: string
  /** True while DeepSeek bills at off-peak (half) rates. */
  readonly offPeak: boolean
  /** Epoch milliseconds of the next peak/off-peak switch, when known. */
  readonly nextSwitchAt?: number
}

/** Persisted ledger row. */
interface LedgerFile {
  /** Local day the accumulator belongs to. */
  date: string
  /** Last observed total, in cents. */
  lastTotal: number
  /** Accumulated spend for that day, in cents. */
  spent: number
}

/** Local calendar day key. */
function localDay(now: number): string {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Parse a decimal money string into cents, tolerating junk. */
function toCents(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

/** Cents back to the display form. */
function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/**
 * Sum one currency across recharge and bonus wallets.
 * @param balance - balance outcome.
 * @param currency - currency to total.
 * @returns total in cents.
 */
export function totalCents(balance: BalanceLike, currency: string): number {
  let total = 0
  for (const wallet of [...balance.value ?? [], ...balance.bonusWallets ?? []]) {
    if (wallet.currency === currency) total += toCents(wallet.balance)
  }
  return total
}

/**
 * Monotonic daily spend ledger.
 *
 * Reads are advisory: a failed query keeps the previous figure and only flips
 * `available`, so a transient platform error cannot reset the day.
 */
export class SpendLedger {
  private state: LedgerFile
  private snapshot: SpendSnapshot

  /**
   * @param file - JSON path the accumulator persists to across restarts.
   * @param currency - wallet currency to follow.
   * @param now - clock injection for tests.
   */
  constructor(
    private readonly file: string,
    private readonly currency = 'CNY',
    private readonly now: () => number = Date.now,
    private readonly rate: (now: number) => OffPeakState = (now) => offPeakAt(new Date(now)),
  ) {
    this.state = this.load()
    this.snapshot = {
      date: this.state.date,
      spent: fromCents(this.state.spent),
      currency,
      balance: null,
      updatedAt: null,
      available: false,
      offPeak: true,
    }
  }

  /**
   * Current figure, without touching the account service.
   *
   * The rate period is re-read here rather than cached with the money: the
   * route is hit at least once a minute, and the period flips on a clock
   * boundary that has nothing to do with the last balance poll.
   * @returns the snapshot with a fresh peak/off-peak flag.
   */
  current(): SpendSnapshot {
    return { ...this.snapshot, ...this.rate(this.now()) }
  }

  /**
   * Poll the account once and fold the reading into today's total.
   * @param read - balance query; returns null while signed out.
   * @returns the refreshed snapshot.
   */
  async refresh(read: () => Promise<BalanceLike | null>): Promise<SpendSnapshot> {
    let balance: BalanceLike | null
    try {
      balance = await read()
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        available: false,
        offPeak: this.current().offPeak,
        reason: `query failed: ${error instanceof Error ? error.message : String(error)}`,
      }
      return this.snapshot
    }
    if (balance === null) {
      this.snapshot = {
        ...this.snapshot,
        available: false,
        offPeak: this.current().offPeak,
        reason: 'signed out (no account grant for this origin)',
      }
      return this.snapshot
    }
    if (balance.status !== 'ready') {
      this.snapshot = {
        ...this.snapshot,
        available: false,
        offPeak: this.current().offPeak,
        reason: 'platform returned a failed balance query',
      }
      return this.snapshot
    }

    const total = totalCents(balance, this.currency)
    const timestamp = this.now()
    const day = localDay(timestamp)
    if (day !== this.state.date) {
      // New day: the first reading becomes its baseline, nothing has been spent yet.
      this.state = { date: day, lastTotal: total, spent: 0 }
    } else if (total < this.state.lastTotal) {
      this.state.spent += this.state.lastTotal - total
      this.state.lastTotal = total
    } else {
      // A rise (top-up, bonus credit) is not spending; move the reference only.
      this.state.lastTotal = total
    }
    this.persist()
    this.snapshot = {
      date: day,
      spent: fromCents(this.state.spent),
      currency: this.currency,
      balance: fromCents(total),
      updatedAt: timestamp,
      available: true,
      ...this.rate(timestamp),
    }
    return this.snapshot
  }

  private load(): LedgerFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<LedgerFile>
      if (typeof parsed.date === 'string'
        && Number.isFinite(parsed.lastTotal)
        && Number.isFinite(parsed.spent)) {
        return { date: parsed.date, lastTotal: parsed.lastTotal as number, spent: parsed.spent as number }
      }
    } catch {
      // Missing or unreadable: start a fresh ledger.
    }
    return { date: localDay(this.now()), lastTotal: 0, spent: 0 }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.state), 'utf8')
    } catch {
      // A decorative readout must never fail the host because of a disk write.
    }
  }
}
