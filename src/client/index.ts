/**
 * Moegirl sprite plugin, browser half: registers the chibi status sprite into
 * ui-layout's frame-wide `shell.overlay` floating layer, and keeps its copy in
 * step with whichever sprite pack is installed.
 *
 * Registration goes through `slots.inject` because apply order against
 * ui-layout's declaration is unconstrained; the contribution follows the
 * declaration's lifetime and unloads with this plugin's fiber.
 *
 * @module dsh-moegirl/client
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
// Type-only: pulls the settings SlotMap merge (the 'settings.section' seat).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MoegirlSprite, type MoegirlInjected } from './MoegirlSprite.tsx'
import { MoegirlSection, type MoegirlSectionInjected } from './MoegirlSection.tsx'
import { en, zh, type MoegirlKey, type MoegirlStateKey } from './locales.ts'
import { packDictionaries } from '../pack-format.ts'
import { currentPack, refreshPack, subscribePack } from './pack-source.ts'

export type { MoegirlSpriteProps, MoegirlInjected } from './MoegirlSprite.tsx'
export type { MoegirlKey } from './locales.ts'
export { currentPack, refreshPack, subscribePack } from './pack-source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin chrome copy plus one bubble per state of the active pack. */
    moegirl: MoegirlKey | MoegirlStateKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'moegirl'

/** Required services: the overlay's slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: dictionaries, the sprite entry in shell.overlay, and the
 * one request that swaps in an installed pack.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The pack owns per-state copy, so its dictionaries ride the same namespace
  // as the plugin's own chrome strings and inherit language selection and the
  // per-key fallback chain. Re-registering on every pack change is what makes
  // an installed pack's bubbles appear without a page reload.
  ctx.effect(() => {
    let dispose = registerCopy()
    const off = subscribePack(() => { dispose(); dispose = registerCopy() })
    return () => { off(); dispose() }
  }, 'dsh-moegirl: pack dictionaries')

  function registerCopy(): () => void {
    const copy = packDictionaries(currentPack())
    return ctx.locale.register(NS, { zh: { ...zh, ...copy.zh }, en: { ...en, ...copy.en } })
  }

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

  // The editor is a settings page rather than a separate app: it ships with the
  // plugin that owns the pack format, so there is nothing extra to install and
  // no second copy of the validator to keep in step.
  const section = (): MoegirlSectionInjected => ({ t: ctx.locale.bind(NS) })
  ctx.effect(
    () => ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'moegirl',
      order: 55,
      label: () => ctx.locale.bind(NS)('editor.nav'),
      locale: NS,
      inject: section,
    }, MoegirlSection)),
    'dsh-moegirl: editor registration',
  )

  // The bundle already carries the built-in pack, so this fetch only ever makes
  // the sprite better: a missing route or a refused document leaves the shipped
  // look in place with a line in the console.
  const controller = new AbortController()
  ctx.effect(() => () => { controller.abort() }, 'dsh-moegirl: pack load')
  void refreshPack(controller.signal).then((result) => {
    if (result.error !== undefined) console.warn(`dsh-moegirl: ${result.error}`)
  })
}
