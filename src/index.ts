/**
 * Moegirl sprite plugin, host half: the sprite-pack store behind the browser
 * half's `/moegirl` routes.
 *
 * The host owns files because the browser cannot: an installed pack is a
 * directory under the harness home, and the editor's save has to survive a
 * reload. The web server is injected conditionally rather than required, so a
 * headless composition that happens to mount this row simply serves nothing
 * instead of waiting forever.
 *
 * @module dsh-moegirl
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { join } from 'node:path'
import { PACK_ROUTE_PREFIX } from './pack-api.ts'
import { PackStore, resolveStoreRoot } from './pack-store.ts'
import { createMoegirlHandler } from './routes.ts'
import { offPeakAt } from './off-peak.ts'
import { SpendLedger, type AccountBalanceReader } from './spend.ts'

export { SpendLedger } from './spend.ts'
export type { InstalledPack } from './pack-store.ts'
export type { SpendSnapshot } from './spend.ts'
export { offPeakAt, shanghaiDate } from './off-peak.ts'
export type { OffPeakSchedule, OffPeakState } from './off-peak.ts'
export type {
  PackErrorResponse,
  PackListResponse,
  PackSummary,
} from './pack-api.ts'

/** How often the host re-reads the account balance for the spend readout. */
const SPEND_POLL_MS = 60_000

/**
 * Retry gap while the account row may still be mounting.
 *
 * A bundle row can mount before the account plugin does, so the first reading
 * legitimately misses the service. That is a boot race, not a fault: retrying on
 * this cadence makes the readout appear within seconds instead of a minute, and
 * it never touches the network because the service is still absent.
 */
const SPEND_RETRY_MS = 2_000

/** Client identity the balance query expects; it only shapes the platform request. */
const ACCOUNT_CLIENT = {
  version: 'dsh-moegirl',
  locale: 'zh-CN',
  timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
}

/** Plugin config: where installed packs live. */
export interface Config {
  /** Store root; defaults to `$DSH_HOME/moegirl`. */
  packsRoot?: string
  /** Balance poll period in milliseconds; defaults to 60000. */
  spendPollMs?: number
  /**
   * Chinese public holidays as `YYYY-MM-DD`, replacing the built-in 2026 table.
   * The State Council republishes the list every year, so this is the knob that
   * keeps the rate icon honest without a plugin release.
   */
  offPeakHolidays?: readonly string[]
}

/**
 * Host plugin body.
 *
 * Nothing is read until a route is hit, so mounting this row costs one map
 * insert and no startup work.
 * @param ctx - host root context.
 * @param config - optional store location.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const root = resolveStoreRoot(config.packsRoot)
  const store = new PackStore(root)

  // The spend readout is read from the account service when the composition
  // has one; a row without it serves the last persisted figure instead of
  // failing to mount. `get` is re-checked on every poll because the account
  // plugin can come and go with the loader.
  const holidays = config.offPeakHolidays
  const spend = new SpendLedger(
    join(root, 'spend.json'),
    'CNY',
    Date.now,
    holidays === undefined
      ? undefined
      : (now) => offPeakAt(new Date(now), { holidayRanges: holidays.map(day => [day, day] as const) }),
  )
  const pollMs = config.spendPollMs ?? SPEND_POLL_MS
  ctx.effect(() => {
    let stopped = false
    let reported: string | undefined
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = (): void => {
      if (stopped) return
      const account = ctx.get('deepseekAccount') as AccountBalanceReader | undefined
      const read = account === undefined
        ? Promise.reject(new Error('deepseekAccount service is not visible from this plugin'))
        : account.getBalance(ACCOUNT_CLIENT)
      void spend.refresh(() => read).then((snapshot) => {
        if (stopped) return
        // Log on change only, and stay quiet through the mount race: one minute
        // of retries must not look like a failure in the terminal.
        const reason = snapshot.available ? undefined : snapshot.reason ?? 'unknown'
        if (reason === undefined) {
          if (reported !== undefined) console.log('[dsh-moegirl] spend readout is live')
          reported = undefined
          failures = 0
        } else {
          failures += 1
          const expectedRace = account === undefined && failures <= 5
          if (!expectedRace && reason !== reported) {
            reported = reason
            console.error('[dsh-moegirl] spend readout unavailable:', reason)
          }
        }
        // Fast retry only while the row may still be mounting; a signed-out
        // account or a failed query waits for the normal cadence.
        timer = setTimeout(poll, account === undefined ? SPEND_RETRY_MS : pollMs)
      })
    }
    poll()
    // The first reading sets today's baseline, so it has to happen before the
    // first spend of the day.
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
  }, 'dsh-moegirl: spend polling')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'prefix',
        path: PACK_ROUTE_PREFIX,
        handler: createMoegirlHandler(store, () => spend.current()),
      }),
      `dsh-moegirl: ${PACK_ROUTE_PREFIX} routes`,
    )
  })
}
