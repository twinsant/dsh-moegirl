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
import { PACK_ROUTE_PREFIX } from './pack-api.ts'
import { PackStore, resolveStoreRoot } from './pack-store.ts'
import { createMoegirlHandler } from './routes.ts'

export type { InstalledPack } from './pack-store.ts'
export type {
  PackErrorResponse,
  PackListResponse,
  PackSummary,
} from './pack-api.ts'

/** Plugin config: where installed packs live. */
export interface Config {
  /** Store root; defaults to `$DSH_HOME/moegirl`. */
  packsRoot?: string
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
  const store = new PackStore(resolveStoreRoot(config.packsRoot))
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: PACK_ROUTE_PREFIX, handler: createMoegirlHandler(store) }),
      `dsh-moegirl: ${PACK_ROUTE_PREFIX} routes`,
    )
  })
}
