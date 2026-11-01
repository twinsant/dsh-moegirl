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
import { SpendLedger, type AccountBalanceReader } from './spend.ts'

export { SpendLedger } from './spend.ts'
export type { InstalledPack } from './pack-store.ts'
export type { SpendSnapshot } from './spend.ts'
export type {
  PackErrorResponse,
  PackListResponse,
  PackSummary,
} from './pack-api.ts'

/** How often the host re-reads the account balance for the spend readout. */
const SPEND_POLL_MS = 60_000

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
  const spend = new SpendLedger(join(root, 'spend.json'))
  const pollMs = config.spendPollMs ?? SPEND_POLL_MS
  ctx.effect(() => {
    let stopped = false
    const poll = (): void => {
      if (stopped) return
      const account = ctx.get('deepseekAccount') as AccountBalanceReader | undefined
      void spend.refresh(() => account?.getBalance(ACCOUNT_CLIENT) ?? Promise.resolve(null))
    }
    poll()
    const timer = setInterval(poll, pollMs)
    // One second after mount, and on every minute boundary: the first reading
    // sets today's baseline, so it has to happen before the first spend.
    return () => { stopped = true; clearInterval(timer) }
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
