/**
 * The client's current sprite pack, and the one fetch that changes it.
 *
 * The bundle ships the built-in pack, so the very first frame renders before
 * any request resolves. When an installed pack is active, the host's
 * `/moegirl/packs/active` document replaces it and every subscriber re-renders.
 * A pack that fails to load is not an error state: the built-in look stays, and
 * the sprite keeps reporting status instead of showing an empty corner.
 *
 * @module dsh-moegirl/pack-source
 */
import { PACK_ACTIVE_PATH } from '../pack-api.ts'
import { validatePack, type SpritePack } from '../pack-format.ts'
import { DEFAULT_PACK } from '../sprite-pack.ts'

/** The pack in force; the built-in resource until a load says otherwise. */
let current: SpritePack = DEFAULT_PACK

const listeners = new Set<() => void>()

/**
 * Everything about a pack except its atlas bytes, serialized for change detection.
 *
 * `atlas.src` is left out on purpose and compared separately as a plain string:
 * for the built-in pack it is a multi-megabyte data URL, and building a signature
 * that embeds it would allocate that much on every load.
 * @param pack - the pack to describe.
 * @returns a comparable string.
 */
function signatureOf(pack: SpritePack): string {
  return JSON.stringify({
    id: pack.id,
    frame: pack.frame,
    count: pack.atlas.count,
    frames: pack.frames,
    sequences: pack.sequences,
    motions: pack.motions,
    states: pack.states,
    fallback: pack.fallback,
    reaction: pack.reaction,
  })
}

/** Signature of {@link current}, kept in step with it so a reload can be a no-op. */
let currentSignature = signatureOf(DEFAULT_PACK)

/**
 * The pack the sprite should render right now.
 * @returns the current pack; a stable reference between loads.
 */
export function currentPack(): SpritePack {
  return current
}

/**
 * Observe pack changes.
 * @param listener - called after the current pack is replaced.
 * @returns the unsubscribe function.
 */
export function subscribePack(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Replace the current pack and wake subscribers; a no-op when nothing changed. */
function publish(pack: SpritePack): void {
  if (pack === current) return
  // Comparing object identity is not enough: every load rebuilds the document
  // from JSON, so the reference never matches and the sprite would restart its
  // animation on every editor refresh even when the pack is unchanged.
  const signature = signatureOf(pack)
  if (signature === currentSignature && pack.atlas.src === current.atlas.src) return
  current = pack
  currentSignature = signature
  for (const listener of [...listeners]) listener()
}

/** Outcome of one attempt to load the active installed pack. */
export interface PackLoadResult {
  /** True when an installed pack became current. */
  installed: boolean
  /** Why the load fell back to the built-in pack, when it did. */
  error?: string
}

/** How long the pack swap waits for the atlas before going ahead anyway. */
const ATLAS_TIMEOUT_MS = 4000

/**
 * Resolve once the atlas image is decoded, or once it is clear that it will not be.
 *
 * The wait is bounded: a pack whose atlas 404s must still leave the sprite
 * somewhere, so the swap happens regardless rather than hanging on a broken image.
 * @param source - the pack's `atlas.src`, a URL or a data URL.
 * @returns a promise that settles either way.
 */
function preloadAtlas(source: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, ATLAS_TIMEOUT_MS)
    const image = new Image()
    image.onload = finish
    image.onerror = finish
    image.src = source
  })
}

/**
 * Load the active installed pack, falling back to the built-in one.
 *
 * Never rejects: a harness with no installed pack, an unreachable route, and a
 * document the validator refuses all end the same way, with the built-in look
 * on screen and a reason in the result.
 *
 * Safe to call again after the editor installs or activates something: the new
 * document is published to the same subscribers the sprite reads, so the corner
 * switches without a page reload.
 * @param signal - abort signal tied to the caller's lifetime.
 * @returns what happened.
 */
export async function refreshPack(signal?: AbortSignal): Promise<PackLoadResult> {
  try {
    const response = await fetch(PACK_ACTIVE_PATH, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      ...(signal !== undefined ? { signal } : {}),
    })
    if (response.status === 404) {
      publish(DEFAULT_PACK)
      return { installed: false }
    }
    if (!response.ok) {
      return { installed: false, error: `${PACK_ACTIVE_PATH} answered ${String(response.status)}` }
    }
    const validation = validatePack(await response.json())
    if (!validation.ok) {
      return { installed: false, error: `installed pack is not a valid pack: ${validation.error}` }
    }
    // Wait for the atlas before publishing. Swapping first would blank the
    // corner for however long the image takes, which reads as a glitch.
    await preloadAtlas(validation.pack.atlas.src)
    publish(validation.pack)
    return { installed: true }
  } catch (error) {
    if (signal?.aborted === true) return { installed: false, error: 'load aborted' }
    return { installed: false, error: error instanceof Error ? error.message : String(error) }
  }
}
