/**
 * Moegirl sprite plugin, browser half: registers the chibi status sprite
 * into ui-layout's frame-wide `shell.overlay` floating layer. Registration
 * goes through `slots.inject` because apply order against ui-layout's
 * declaration is unconstrained; the contribution follows the declaration's
 * lifetime and unloads with this plugin's fiber.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the GlobalStandardProps merge (useSessions /
// useSessionPendingInteraction) the sprite's mood derivation reads.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ui-layout SlotMap merge (the 'shell.overlay' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Context merge that puts the slot registry on `ctx.slots`.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MoegirlSprite, type MoegirlInjected } from './MoegirlSprite.tsx'
import { en, zh, type MoegirlKey } from './locales.ts'

export type { MoegirlSpriteProps, MoegirlInjected } from './MoegirlSprite.tsx'
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

  // The bubble opens the session whose fact elected the current mood. The
  // session service is looked up per click instead of injected: the sprite
  // still reports status when no session UI is mounted, and the bubble simply
  // stays inert.
  const injected = (): MoegirlInjected => ({
    openSession: (sessionId: string) => {
      const sessions = ctx.get('sessions') as { open?: (id: string) => void } | undefined
      sessions?.open?.(sessionId)
    },
  })

  ctx.effect(
    () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'moegirl',
      locale: NS,
      label: 'Moegirl sprite',
      inject: injected,
    }, MoegirlSprite)),
    'dsh-moegirl: sprite registration',
  )
}
