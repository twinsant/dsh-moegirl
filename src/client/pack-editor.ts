/**
 * The pack editor's working model: a draft document the page can mutate freely,
 * plus the two conversions to and from the wire format.
 *
 * The draft is deliberately flatter than a pack. Sections are keyed by name and
 * edited as tables, arrays keep their order so a keyframe does not jump while
 * being typed, and the atlas can be a local data URL that has never reached the
 * server. Nothing here touches React or the network, so the whole editing model
 * is testable on its own.
 *
 * @module dsh-moegirl/pack-editor
 */
import {
  validatePack,
  type PackMotion,
  type PackSequence,
  type PackState,
  type SpritePack,
} from '../pack-format.ts'
import { DEFAULT_PACK } from '../sprite-pack.ts'

/**
 * The moods the plugin can ask for, in precedence order. These ids are the
 * contract between plugin and pack; a pack must define all of them or the
 * sprite falls back for the missing ones.
 */
export const MOODS = ['idle', 'working', 'attention', 'approval', 'done'] as const

/** One mood id. */
export type Mood = (typeof MOODS)[number]

/** Frame names a freshly seeded pack defines, in atlas order. */
const SEED_FRAMES = ['idle', 'blink', 'working', 'attention', 'done', 'approval'] as const

/** What the editor holds while a pack is being worked on. */
export interface PackDraft {
  /** Pack identity; also the install directory name. */
  id: string
  /** Display name. */
  name: string
  /** One frame's size in the sheet. */
  frameWidth: number
  /** One frame's height in the sheet. */
  frameHeight: number
  /** Atlas row count. */
  count: number
  /** Image the preview draws: an imported data URL, or the installed atlas URL. */
  atlasSrc: string
  /** True when {@link PackDraft.atlasSrc} is a data URL that travels with the install. */
  atlasLocal: boolean
  /** Frame name to atlas row, in display order. */
  frames: Record<string, number>
  /** Reusable frame sequences. */
  sequences: Record<string, PackSequence>
  /** Reusable transform motions. */
  motions: Record<string, PackMotion>
  /** Mood id to presentation. */
  states: Record<string, PackState>
  /** State used for an id the pack does not define. */
  fallback: string
  /** Click motion name. */
  reactionMotion: string
  /** Click emote. */
  reactionEmote: string
  /**
   * Natural size of the imported sheet, when the draft came from a file. It is
   * editor bookkeeping rather than pack data, and is what lets the frame count
   * recompute the frame height.
   */
  sourceImage?: { width: number; height: number }
}

/** Copy a value deeply; drafts are mutated, and the seeds must not be. */
function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * Build a draft from an installed pack.
 * @param pack - the pack to edit.
 * @param atlasSrc - image the preview should draw.
 * @param atlasLocal - whether that image is a data URL.
 * @returns a mutable draft.
 */
export function draftFromPack(pack: SpritePack, atlasSrc: string, atlasLocal: boolean): PackDraft {
  const states: Record<string, PackState> = {}
  for (const [id, state] of Object.entries(pack.states)) states[id] = clone(state)
  // A pack that predates a mood still has to be editable in full, so the
  // editor fills the gap with the shipped presentation rather than hiding it.
  for (const mood of MOODS) {
    if (states[mood] !== undefined) continue
    const seed = DEFAULT_PACK.states[mood]
    const firstFrame = Object.keys(pack.frames)[0]
    states[mood] = {
      frame: firstFrame ?? '',
      ...(seed?.sequence !== undefined ? { sequence: seed.sequence } : {}),
      ...(seed?.motion !== undefined ? { motion: seed.motion } : {}),
      bubble: clone(seed?.bubble ?? { zh: mood, en: mood }),
    }
  }
  return {
    id: pack.id,
    name: pack.name,
    frameWidth: pack.frame.width,
    frameHeight: pack.frame.height,
    count: pack.atlas.count,
    atlasSrc,
    atlasLocal,
    frames: { ...pack.frames },
    sequences: clone(pack.sequences ?? {}),
    motions: clone(pack.motions ?? {}),
    states,
    fallback: pack.fallback,
    reactionMotion: pack.reaction?.motion ?? 'reaction',
    reactionEmote: pack.reaction?.emote ?? '♥',
  }
}

/** What a freshly imported sheet tells the editor. */
export interface SheetImport {
  /** Suggested pack id. */
  id: string
  /** Suggested display name. */
  name: string
  /** The imported image as a data URL. */
  atlasSrc: string
  /** Image width in pixels. */
  imageWidth: number
  /** Image height in pixels. */
  imageHeight: number
}

/**
 * Guess a frame count and height from a sheet's proportions.
 *
 * The shipped sheet is 384×4002 with six 667-pixel frames, so assuming square
 * frames guesses ten and lands nowhere near usable. Every candidate count is
 * scored instead, by how close its frame shape sits to a portrait character
 * cell, with a penalty for a frame height that is not a whole number of pixels.
 * The result is a prefill that is usually already right and always editable.
 * @param imageWidth - sheet width in pixels.
 * @param imageHeight - sheet height in pixels.
 * @returns the guessed frame size and count.
 */
export function guessFrames(imageWidth: number, imageHeight: number): { frameWidth: number; frameHeight: number; count: number } {
  if (imageWidth <= 0 || imageHeight <= 0) return { frameWidth: 1, frameHeight: 1, count: 1 }
  const MAX_SHEET_FRAMES = 32
  /** A character cell is taller than it is wide; 1.6 is the middle of the usual range. */
  const TARGET_ASPECT = 1.6
  /** How much worse a frame height that is not a whole pixel number is. */
  const FRACTIONAL_PENALTY = 0.35
  let best = { count: 1, frameHeight: imageHeight, score: Math.abs(Math.log(imageHeight / imageWidth / TARGET_ASPECT)) }
  for (let count = 2; count <= MAX_SHEET_FRAMES; count += 1) {
    const height = imageHeight / count
    if (height < 1) break
    const score = Math.abs(Math.log(height / imageWidth / TARGET_ASPECT)) + (Number.isInteger(height) ? 0 : FRACTIONAL_PENALTY)
    if (score < best.score - 1e-9) best = { count, frameHeight: Math.round(height), score }
  }
  return { frameWidth: imageWidth, frameHeight: Math.max(1, best.frameHeight), count: best.count }
}

/**
 * Build a draft for a newly imported sheet, seeded from the shipped pack.
 *
 * Seeding matters: a new pack starts with the built-in motions, sequences, and
 * bubble copy, so a first import animates immediately instead of asking for
 * twenty numbers before anything moves.
 * @param sheet - the imported sheet.
 * @returns a mutable draft that is already a valid pack.
 */
export function draftFromSheet(sheet: SheetImport): PackDraft {
  const guessed = guessFrames(sheet.imageWidth, sheet.imageHeight)
  const draft = draftFromPack(DEFAULT_PACK, sheet.atlasSrc, true)
  draft.id = sheet.id
  draft.name = sheet.name
  draft.frameWidth = guessed.frameWidth
  draft.frameHeight = guessed.frameHeight
  draft.count = guessed.count
  draft.sourceImage = { width: sheet.imageWidth, height: sheet.imageHeight }
  const frames: Record<string, number> = {}
  SEED_FRAMES.forEach((name, index) => { frames[name] = Math.min(index, guessed.count - 1) })
  draft.frames = frames
  return draft
}

/**
 * Project a draft onto the wire format.
 *
 * Normalizes the one field validation refuses in its raw form: an empty English
 * bubble inherits the Chinese text, so a single-language pack still answers for
 * both locales.
 * @param draft - the draft to project.
 * @returns the document to install or export.
 */
export function packFromDraft(draft: PackDraft): SpritePack {
  const states: Record<string, PackState> = {}
  for (const [id, state] of Object.entries(draft.states)) {
    const en = state.bubble.en.trim()
    states[id] = {
      frame: state.frame,
      ...(state.sequence !== undefined && state.sequence !== '' ? { sequence: state.sequence } : {}),
      ...(state.motion !== undefined && state.motion !== '' ? { motion: state.motion } : {}),
      bubble: en === '' ? { zh: state.bubble.zh, en: state.bubble.zh } : { zh: state.bubble.zh, en },
    }
  }
  return {
    format: 'dsh-moegirl/pack',
    version: 1,
    id: draft.id.trim(),
    name: draft.name.trim(),
    frame: { width: Math.round(draft.frameWidth), height: Math.round(draft.frameHeight) },
    atlas: { src: draft.atlasSrc, count: Math.round(draft.count) },
    frames: { ...draft.frames },
    sequences: clone(draft.sequences),
    motions: clone(draft.motions),
    states,
    fallback: draft.fallback,
    ...(draft.reactionMotion !== '' ? { reaction: { motion: draft.reactionMotion, emote: draft.reactionEmote } } : {}),
  }
}

/** Why a draft cannot be installed yet. */
export type DraftProblem =
  | { kind: 'atlas' }
  | { kind: 'name' }
  /** A message from the format validator, already naming the offending field. */
  | { kind: 'format'; message: string }

/** Outcome of checking a draft the way the loader would. */
export type DraftCheck =
  | { ok: true; pack: SpritePack }
  | { ok: false; problem: DraftProblem }

/**
 * Check a draft as the loader would.
 * @param draft - the draft to check.
 * @returns the accepted document, or why it is not installable yet.
 */
export function validateDraft(draft: PackDraft): DraftCheck {
  if (draft.atlasSrc === '') return { ok: false, problem: { kind: 'atlas' } }
  if (draft.name.trim() === '') return { ok: false, problem: { kind: 'name' } }
  const validation = validatePack(packFromDraft(draft))
  return validation.ok ? validation : { ok: false, problem: { kind: 'format', message: validation.error } }
}

/**
 * Rename a key in an ordered table, keeping its position.
 *
 * A rename is the common edit and a naive delete-then-insert would move the row
 * to the end, which makes tables jump under the cursor.
 * @param table - the table to rewrite.
 * @param from - current key.
 * @param to - new key; a collision or an empty value leaves the table alone.
 * @returns the rewritten table.
 */
export function renameKey<T>(table: Record<string, T>, from: string, to: string): Record<string, T> {
  const trimmed = to.trim()
  if (trimmed === '' || trimmed === from || table[trimmed] !== undefined) return table
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(table)) next[key === from ? trimmed : key] = value
  return next
}

/**
 * Rebuild one state, dropping keys that were cleared so the pack stays minimal.
 * @param draft - the draft to update.
 * @param id - state id.
 * @param patch - fields to merge; a `null` removes the key.
 * @returns the updated draft.
 */
export function patchState(draft: PackDraft, id: string, patch: { frame?: string; sequence?: string | null; motion?: string | null; bubble?: Partial<PackState['bubble']> }): PackDraft {
  const current = draft.states[id]
  if (current === undefined) return draft
  const next: PackState = {
    frame: patch.frame ?? current.frame,
    bubble: { ...current.bubble, ...patch.bubble },
  }
  const sequence = patch.sequence === undefined ? current.sequence : patch.sequence
  const motion = patch.motion === undefined ? current.motion : patch.motion
  if (sequence !== undefined && sequence !== null && sequence !== '') next.sequence = sequence
  if (motion !== undefined && motion !== null && motion !== '') next.motion = motion
  return { ...draft, states: { ...draft.states, [id]: next } }
}
