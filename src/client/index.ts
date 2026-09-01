/**
 * Moegirl sprite plugin, browser half: registers the chibi status sprite
 * into ui-layout's frame-wide `shell.overlay` floating layer. Registration
 * goes through `slots.inject` because apply order against ui-layout's
 * declaration is unconstrained; the contribution follows the declaration's
 * lifetime and unloads with this plugin's fiber.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-layout SlotMap merge (the 'shell.overlay' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { MoegirlSprite } from './MoegirlSprite.tsx'
import { en, zh, type MoegirlKey } from './locales.ts'

export type { MoegirlSpriteProps } from './MoegirlSprite.tsx'
export type { MoegirlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop sprite copy. */
    moegirl: MoegirlKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'moegirl'

/** Required services: the overlay's slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: dictionaries, then the sprite entry in shell.overlay.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-moegirl: dictionaries')

  ctx.effect(
    () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'moegirl',
      locale: NS,
      label: 'Moegirl sprite',
    }, MoegirlSprite)),
    'dsh-moegirl: sprite registration',
  )
}
