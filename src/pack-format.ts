/**
 * The sprite-pack format: the document shape, its validator, and the pure
 * projections the player and the locale registry need.
 *
 * This module deliberately imports nothing from the built-in assets. The host
 * half validates packs on save and must not drag the compiled atlas into the
 * Node bundle; {@link import('./sprite-pack.ts').DEFAULT_PACK}, which does own
 * that atlas, lives in the sibling module.
 *
 * @module dsh-moegirl/pack-format
 */

/** One transform keyframe: bare numbers are pixels for translate, degrees for rotate. */
export interface PackTransform {
  /** Horizontal offset in px. */
  translateX?: number
  /** Vertical offset in px, negative moves up. */
  translateY?: number
  /** Clockwise rotation in degrees. */
  rotate?: number
  /** Uniform scale, or `[x, y]` for a squash/stretch pair. */
  scale?: number | [number, number]
}

/** One keyframe on a motion's transform track. */
export interface PackMotionKey extends PackTransform {
  /** Offset along the motion, `0` to `1`. */
  at: number
}

/** A transform motion: what moves, over how long, with which easing. */
export interface PackMotion {
  /** Seconds for one pass. */
  duration: number
  /** CSS easing keyword or `cubic-bezier(...)` string. */
  easing?: string
  /** Play once instead of looping (an interaction flourish rather than a state). */
  once?: boolean
  /** Keyframes in ascending `at` order. */
  track: readonly PackMotionKey[]
}

/** One run of a single frame on a sequence's frame track. */
export interface PackFrameSegment {
  /** Named frame, resolved through {@link SpritePack.frames}. */
  frame: string
  /** Seconds this frame stays on screen. */
  hold: number
}

/** A frame sequence: the sprite animation that drives `background-position`. */
export interface PackSequence {
  /**
   * Cut between frames instead of interpolating. Panning a vertical sheet
   * between two frames scrolls the art, so every sheet-driven sequence wants
   * this on.
   */
  steps?: boolean
  /** Segments in playback order; the sequence length is their sum. */
  segments: readonly PackFrameSegment[]
}

/** Per-state copy, keyed by locale. */
export interface PackBubble {
  readonly zh: string
  readonly en: string
}

/** What one mood shows and says. */
export interface PackState {
  /** Frame shown while no sequence is running. */
  frame: string
  /** Frame sequence driving the sprite animation, when the state has one. */
  sequence?: string
  /** Transform motion for the state. */
  motion?: string
  /** Speech-bubble copy. */
  bubble: PackBubble
}

/** One installable character sprite resource. */
export interface SpritePack {
  /** Format discriminator, checked on load. */
  format: 'dsh-moegirl/pack'
  /** Format revision, so a newer document can be migrated. */
  version: number
  /** Stable pack identity; also the install directory name. */
  id: string
  /** Human-readable name shown by the pack picker. */
  name: string
  /** One atlas frame's size in source pixels. */
  frame: { width: number; height: number }
  /** Atlas image and frame count, arranged in one column. */
  atlas: { src: string; count: number }
  /** Named frame to atlas row. */
  frames: Readonly<Record<string, number>>
  /** Reusable frame sequences. */
  sequences?: Readonly<Record<string, PackSequence>>
  /** Reusable transform motions. */
  motions?: Readonly<Record<string, PackMotion>>
  /** Mood id to presentation. */
  states: Readonly<Record<string, PackState>>
  /** State used when the plugin asks for an id this pack does not define. */
  fallback: string
  /** The click reaction: which motion to play, and the emote it floats. */
  reaction?: { motion: string; emote: string }
}

/** The format revision this build writes and accepts. */
export const PACK_VERSION = 1

/** Format discriminator value; the pair with {@link PACK_VERSION} defines compatibility. */
export const PACK_FORMAT = 'dsh-moegirl/pack'

/** A pack id has to survive a round trip through a directory name. */
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/** Validation failure carrying a message written for whoever authored the pack. */
class PackError extends Error {}

/** Validation outcome: the accepted pack, or why it was refused. */
export type PackValidation =
  | { ok: true; pack: SpritePack }
  | { ok: false; error: string }

/** Narrow an unknown value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a required record field, refusing arrays and null. */
function field(source: Record<string, unknown>, key: string, where: string): Record<string, unknown> {
  const value = source[key]
  if (!isRecord(value)) throw new PackError(`${where}.${key} must be an object`)
  return value
}

/** Read a required non-empty string field. */
function text(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PackError(`${where}.${key} must be a non-empty string`)
  }
  return value
}

/** Read an optional non-empty string field. */
function optionalText(source: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PackError(`${where}.${key} must be a non-empty string when present`)
  }
  return value
}

/** Read a required number field, bounded to a closed range. */
function count(source: Record<string, unknown>, key: string, where: string, min: number, max: number): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new PackError(`${where}.${key} must be a number between ${min} and ${max}`)
  }
  return value
}

/** Read an optional boolean field. */
function optionalFlag(source: Record<string, unknown>, key: string, where: string): boolean | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new PackError(`${where}.${key} must be a boolean when present`)
  return value
}

/** Read an optional record-of-objects field, validating each entry through `row`. */
function optionalTable<T>(
  source: Record<string, unknown>,
  key: string,
  where: string,
  row: (entry: Record<string, unknown>, at: string) => T,
): Record<string, T> | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new PackError(`${where}.${key} must be an object`)
  const table: Record<string, T> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) throw new PackError(`${where}.${key}.${name} must be an object`)
    table[name] = row(entry, `${where}.${key}.${name}`)
  }
  return table
}

/** Validate one transform keyframe, keeping only the fields it declares. */
function motionKey(entry: Record<string, unknown>, where: string): PackMotionKey {
  const at = count(entry, 'at', where, 0, 1)
  const key: PackMotionKey = { at }
  for (const axis of ['translateX', 'translateY', 'rotate'] as const) {
    const value = entry[axis]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new PackError(`${where}.${axis} must be a finite number when present`)
    }
    key[axis] = value
  }
  const scale = entry.scale
  if (scale !== undefined) {
    if (typeof scale === 'number' && Number.isFinite(scale)) key.scale = scale
    else if (Array.isArray(scale) && scale.length === 2 && scale.every(n => typeof n === 'number' && Number.isFinite(n))) {
      key.scale = [scale[0] as number, scale[1] as number]
    } else {
      throw new PackError(`${where}.scale must be a finite number or a [x, y] pair`)
    }
  }
  return key
}

/**
 * Parse and validate a pack document.
 *
 * Accepts the browser-authored form as well as a hand-written file, and
 * normalizes the two forgiving spots (a missing English bubble, an omitted
 * `steps` flag) so callers always see the same complete shape. Both halves of
 * the plugin run this: the host refuses to install a document the loader would
 * later refuse, which is what keeps a saved pack loadable.
 *
 * @param value - the parsed JSON document to check.
 * @returns the accepted pack, or the reason it was refused.
 */
export function validatePack(value: unknown): PackValidation {
  try {
    if (!isRecord(value)) throw new PackError('a pack must be a JSON object')
    if (value.format !== PACK_FORMAT) throw new PackError(`pack.format must be "${PACK_FORMAT}"`)
    if (value.version !== PACK_VERSION) {
      throw new PackError(`pack.version must be ${PACK_VERSION}, got ${String(value.version)}`)
    }

    const id = text(value, 'id', 'pack')
    if (!PACK_ID_PATTERN.test(id)) {
      throw new PackError('pack.id must start with a letter or digit and contain only letters, digits, "-", "_" (max 64)')
    }
    const name = text(value, 'name', 'pack')

    const frameRecord = field(value, 'frame', 'pack')
    const frame = {
      width: count(frameRecord, 'width', 'pack.frame', 1, 8192),
      height: count(frameRecord, 'height', 'pack.frame', 1, 8192),
    }

    const atlasRecord = field(value, 'atlas', 'pack')
    const atlas = {
      src: text(atlasRecord, 'src', 'pack.atlas'),
      count: count(atlasRecord, 'count', 'pack.atlas', 1, 512),
    }

    const framesRecord = field(value, 'frames', 'pack')
    const frames: Record<string, number> = {}
    for (const [frameName, row] of Object.entries(framesRecord)) {
      if (typeof row !== 'number' || !Number.isInteger(row) || row < 0 || row >= atlas.count) {
        throw new PackError(`pack.frames.${frameName} must be an atlas row between 0 and ${atlas.count - 1}`)
      }
      frames[frameName] = row
    }
    if (Object.keys(frames).length === 0) throw new PackError('pack.frames must name at least one frame')

    const sequences = optionalTable(value, 'sequences', 'pack', (entry, where) => {
      const segments = entry.segments
      if (!Array.isArray(segments) || segments.length === 0) {
        throw new PackError(`${where}.segments must be a non-empty array`)
      }
      const parsed: PackFrameSegment[] = segments.map((segment, index) => {
        if (!isRecord(segment)) throw new PackError(`${where}.segments[${index}] must be an object`)
        const frameName = text(segment, 'frame', `${where}.segments[${index}]`)
        if (frames[frameName] === undefined) {
          throw new PackError(`${where}.segments[${index}].frame "${frameName}" is not a declared frame`)
        }
        return { frame: frameName, hold: count(segment, 'hold', `${where}.segments[${index}]`, 0.001, 600) }
      })
      return { steps: optionalFlag(entry, 'steps', where), segments: parsed }
    })

    const motions = optionalTable(value, 'motions', 'pack', (entry, where) => {
      const track = entry.track
      if (!Array.isArray(track) || track.length === 0) {
        throw new PackError(`${where}.track must be a non-empty array of keyframes`)
      }
      let previous = -1
      const parsed = track.map((keyframe, index) => {
        if (!isRecord(keyframe)) throw new PackError(`${where}.track[${index}] must be an object`)
        const key = motionKey(keyframe, `${where}.track[${index}]`)
        if (key.at < previous) throw new PackError(`${where}.track must be in ascending "at" order`)
        previous = key.at
        return key
      })
      return {
        duration: count(entry, 'duration', where, 0.001, 600),
        easing: optionalText(entry, 'easing', where),
        once: optionalFlag(entry, 'once', where),
        track: parsed,
      }
    })

    const statesRecord = field(value, 'states', 'pack')
    const states: Record<string, PackState> = {}
    for (const [stateId, raw] of Object.entries(statesRecord)) {
      const where = `pack.states.${stateId}`
      if (!isRecord(raw)) throw new PackError(`${where} must be an object`)
      const frameName = text(raw, 'frame', where)
      if (frames[frameName] === undefined) throw new PackError(`${where}.frame "${frameName}" is not a declared frame`)
      const sequence = optionalText(raw, 'sequence', where)
      if (sequence !== undefined && sequences?.[sequence] === undefined) {
        throw new PackError(`${where}.sequence "${sequence}" is not a declared sequence`)
      }
      const motion = optionalText(raw, 'motion', where)
      if (motion !== undefined && motions?.[motion] === undefined) {
        throw new PackError(`${where}.motion "${motion}" is not a declared motion`)
      }
      const bubbleRecord = field(raw, 'bubble', where)
      const zh = text(bubbleRecord, 'zh', `${where}.bubble`)
      // A pack that ships one language still has to answer for both, so the
      // other side of the pair inherits rather than rendering an empty bubble.
      const en = optionalText(bubbleRecord, 'en', `${where}.bubble`) ?? zh
      states[stateId] = { frame: frameName, sequence, motion, bubble: { zh, en } }
    }
    if (Object.keys(states).length === 0) throw new PackError('pack.states must define at least one state')

    const fallback = text(value, 'fallback', 'pack')
    if (states[fallback] === undefined) throw new PackError(`pack.fallback "${fallback}" is not a declared state`)

    let reaction: { motion: string; emote: string } | undefined
    if (value.reaction !== undefined) {
      const raw = field(value, 'reaction', 'pack')
      const motion = text(raw, 'motion', 'pack.reaction')
      if (motions?.[motion] === undefined) throw new PackError(`pack.reaction.motion "${motion}" is not a declared motion`)
      reaction = { motion, emote: text(raw, 'emote', 'pack.reaction') }
    }

    return {
      ok: true,
      pack: {
        format: PACK_FORMAT,
        version: PACK_VERSION,
        id,
        name,
        frame,
        atlas,
        frames,
        ...(sequences !== undefined ? { sequences } : {}),
        ...(motions !== undefined ? { motions } : {}),
        states,
        fallback,
        ...(reaction !== undefined ? { reaction } : {}),
      },
    }
  } catch (error) {
    if (error instanceof PackError) return { ok: false, error: error.message }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Project a pack's per-state copy into locale dictionary entries, keyed
 * `state.<id>.bubble`. Registering these alongside the plugin's own chrome copy
 * is what keeps language selection and the per-key fallback chain working for
 * whatever pack is installed.
 * @param pack - the pack supplying state copy.
 * @returns dictionaries for the two locales every pack carries.
 */
export function packDictionaries(pack: SpritePack): { zh: Record<string, string>; en: Record<string, string> } {
  const zh: Record<string, string> = {}
  const en: Record<string, string> = {}
  for (const [id, state] of Object.entries(pack.states)) {
    zh[`state.${id}.bubble`] = state.bubble.zh
    en[`state.${id}.bubble`] = state.bubble.en
  }
  return { zh, en }
}

/**
 * Build the CSS transform string for one keyframe.
 * @param transform - the keyframe's transform fields.
 * @returns a `transform` value; `none` when the keyframe declares no transform.
 */
export function transformCss(transform: PackTransform): string {
  const parts: string[] = []
  if (transform.translateX !== undefined || transform.translateY !== undefined) {
    parts.push(`translate(${transform.translateX ?? 0}px, ${transform.translateY ?? 0}px)`)
  }
  if (transform.rotate !== undefined) parts.push(`rotate(${transform.rotate}deg)`)
  if (transform.scale !== undefined) {
    const scale = Array.isArray(transform.scale) ? transform.scale : [transform.scale, transform.scale]
    parts.push(`scale(${scale[0]}, ${scale[1]})`)
  }
  return parts.length === 0 ? 'none' : parts.join(' ')
}
