/**
 * The built-in sprite pack: the shipped look, and the fallback when no
 * installed pack loads.
 *
 * A pack is an installable resource carrying a character's frames, motions,
 * and state copy, so a sprite's look can be authored and swapped without
 * touching plugin code. The split is deliberate: a pack owns presentation only
 * — which atlas frames exist, which frames a state shows, what moves and how
 * fast, what the bubble says — while the plugin keeps semantics: which mood is
 * current, how moods rank, and what a click does. A state id is the contract
 * between them.
 *
 * This module owns the one atlas that ships inside the bundle; the format
 * itself, its validator, and the pure projections live in
 * {@link import('./pack-format.ts')}, which the host half can import without
 * pulling image bytes into Node.
 *
 * @module dsh-moegirl/sprite-pack
 */
import { SPRITE_SHEET, SPRITE_FRAME } from './assets.ts'
import { PACK_FORMAT, PACK_VERSION, type SpritePack } from './pack-format.ts'

export type {
  PackBubble,
  PackFrameSegment,
  PackMotion,
  PackMotionKey,
  PackSequence,
  PackState,
  PackTransform,
  PackValidation,
  SpritePack,
} from './pack-format.ts'
export { PACK_FORMAT, PACK_VERSION, packDictionaries, transformCss, validatePack } from './pack-format.ts'

/**
 * The built-in pack. Frame order matches the compiled sheet — idle, blink,
 * working, attention, done, approval — and every motion transcribes the
 * keyframes the stylesheet used to hard-code, so moving to a resource format
 * changed no pixels.
 */
export const DEFAULT_PACK: SpritePack = {
  format: PACK_FORMAT,
  version: PACK_VERSION,
  id: 'moegirl',
  name: '萌妹精灵',
  frame: { width: SPRITE_FRAME.width, height: SPRITE_FRAME.height },
  atlas: { src: SPRITE_SHEET, count: SPRITE_FRAME.count },
  frames: { idle: 0, blink: 1, working: 2, attention: 3, done: 4, approval: 5 },
  sequences: {
    // 4.8s at steps(1,end): the cut to the closed frame lands at 94% and holds
    // to the loop point, which is 4.512s open and 0.288s closed.
    blink: { steps: true, segments: [{ frame: 'idle', hold: 4.512 }, { frame: 'blink', hold: 0.288 }] },
  },
  motions: {
    breathe: {
      duration: 3.2,
      easing: 'ease-in-out',
      track: [{ at: 0, translateY: 0 }, { at: 0.5, translateY: -2 }, { at: 1, translateY: 0 }],
    },
    hop: {
      duration: 0.6,
      easing: 'ease-in-out',
      track: [{ at: 0, translateY: 0 }, { at: 0.5, translateY: -6 }, { at: 1, translateY: 0 }],
    },
    rejoice: {
      duration: 1.1,
      easing: 'ease-in-out',
      track: [
        { at: 0, translateY: 0, rotate: 0 },
        { at: 0.3, translateY: -7, rotate: -3 },
        { at: 0.6, translateY: 0, rotate: 0 },
        { at: 0.8, translateY: -3, rotate: 2 },
        { at: 1, translateY: 0, rotate: 0 },
      ],
    },
    'await-decision': {
      duration: 2.4,
      easing: 'ease-in-out',
      track: [
        { at: 0, translateY: 0, rotate: 0 },
        { at: 0.58, translateY: 0, rotate: 0 },
        { at: 0.7, translateY: -4, rotate: -1.8 },
        { at: 0.82, translateY: 0, rotate: 1.2 },
        { at: 1, translateY: 0, rotate: 0 },
      ],
    },
    reaction: {
      duration: 0.7,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      once: true,
      track: [
        { at: 0, scale: 1 },
        { at: 0.3, scale: [1.06, 0.94] },
        { at: 0.55, scale: [0.95, 1.05], translateY: -8 },
        { at: 1, scale: 1 },
      ],
    },
  },
  states: {
    idle: {
      frame: 'idle',
      sequence: 'blink',
      motion: 'breathe',
      bubble: { zh: '现在没有任务，摸摸鱼～', en: 'No tasks right now, taking a break~' },
    },
    working: {
      frame: 'working',
      motion: 'hop',
      bubble: { zh: '正在努力工作…', en: 'Working hard…' },
    },
    attention: {
      frame: 'attention',
      motion: 'breathe',
      bubble: { zh: '有会话在等待你的操作！', en: 'A session is waiting for you!' },
    },
    approval: {
      frame: 'approval',
      motion: 'await-decision',
      bubble: { zh: '有会话等待你的批准！', en: 'A session is waiting for your approval!' },
    },
    done: {
      frame: 'done',
      motion: 'rejoice',
      bubble: { zh: '任务完成啦，快去看看～', en: 'A task just finished, take a look~' },
    },
  },
  fallback: 'idle',
  reaction: { motion: 'reaction', emote: '♥' },
}
