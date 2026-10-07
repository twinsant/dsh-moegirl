/**
 * Pack player: turn one pack state into running animations on the sprite
 * figure, and hand back a handle that stops exactly what it started.
 *
 * Two tracks run side by side on the same element, each owning one property:
 * a frame sequence drives `background-position` (the sprite animation), and a
 * transform motion drives `transform`. They are separate animations because
 * they have separate durations and easings, and because Web Animations
 * composes them without either clobbering the other.
 *
 * @module dsh-moegirl/pack-player
 */
import type { PackMotion, PackSequence, SpritePack } from '../sprite-pack.ts'
import { transformCss } from '../sprite-pack.ts'

/** Animations started for one state, plus their teardown. */
export interface PackPlayback {
  /** Cancel every animation this playback started. */
  stop(): void
  /** Resolves when the non-looping tracks finish; never settles for looping ones. */
  finished: Promise<void>
}

/** Nothing playing; a stable handle for states with no animation. */
const IDLE_PLAYBACK: PackPlayback = { stop: () => {}, finished: Promise.resolve() }

/**
 * Resolve a named frame to its atlas row.
 * @param pack - the pack owning the frame names.
 * @param frame - frame id; unknown ids fall back to the first row.
 * @returns the atlas row index.
 */
export function frameRow(pack: SpritePack, frame: string): number {
  const row = pack.frames[frame]
  return typeof row === 'number' && row >= 0 ? row : 0
}

/**
 * Resolve a state id, honouring the pack's declared fallback.
 * @param pack - the pack to look in.
 * @param state - requested state id.
 * @returns the state, or `undefined` when the pack defines neither the id nor its fallback.
 */
export function stateOf(pack: SpritePack, state: string): SpritePack['states'][string] | undefined {
  return pack.states[state] ?? pack.states[pack.fallback]
}

/**
 * Expand a frame sequence into `background-position` keyframes.
 *
 * Offsets land on segment boundaries and the animation runs at `steps(1, end)`,
 * which is what keeps a sheet-driven animation as a hard cut: interpolating
 * between two rows would scroll the art instead of switching frames.
 * @param pack - the pack owning the frames.
 * @param sequence - the sequence to expand.
 * @param frameHeight - one frame's rendered height in px.
 * @returns keyframes plus the total duration in ms.
 */
function sequenceFrames(
  pack: SpritePack,
  sequence: PackSequence,
  frameHeight: number,
): { keyframes: Keyframe[]; duration: number } {
  const total = sequence.segments.reduce((sum, segment) => sum + Math.max(0, segment.hold), 0)
  const keyframes: Keyframe[] = []
  let elapsed = 0
  for (const segment of sequence.segments) {
    keyframes.push({
      offset: total === 0 ? 0 : elapsed / total,
      backgroundPosition: `0 ${-frameRow(pack, segment.frame) * frameHeight}px`,
    })
    elapsed += Math.max(0, segment.hold)
  }
  const first = sequence.segments[0]
  // Close the loop on the opening frame so the wrap-around is a cut to the
  // same value the sequence starts at, never a slide back.
  if (first !== undefined) {
    keyframes.push({ offset: 1, backgroundPosition: `0 ${-frameRow(pack, first.frame) * frameHeight}px` })
  }
  return { keyframes, duration: total * 1000 }
}

/**
 * Expand a transform motion into `transform` keyframes.
 * @param motion - the motion to expand.
 * @returns keyframes in ascending offset order.
 */
function motionFrames(motion: PackMotion): Keyframe[] {
  return motion.track.map(key => ({ offset: key.at, transform: transformCss(key) }))
}

/**
 * Play one pack state on a figure.
 * @param figure - the element whose background and transform carry the sprite.
 * @param pack - the pack supplying frames and motions.
 * @param state - requested state id, resolved through the pack's fallback.
 * @param frameHeight - one frame's rendered height in px.
 * @returns a playback handle; a no-op handle when the state has no animation.
 */
export function playState(
  figure: HTMLElement,
  pack: SpritePack,
  state: string,
  frameHeight: number,
): PackPlayback {
  const resolved = stateOf(pack, state)
  if (resolved === undefined) return IDLE_PLAYBACK

  const running: Animation[] = []
  let finished: Promise<void> = Promise.resolve()

  const sequence = resolved.sequence === undefined ? undefined : pack.sequences?.[resolved.sequence]
  if (sequence !== undefined && sequence.segments.length > 0) {
    const { keyframes, duration } = sequenceFrames(pack, sequence, frameHeight)
    if (duration > 0) {
      running.push(figure.animate(keyframes, {
        duration,
        easing: sequence.steps === true ? 'steps(1, end)' : 'linear',
        iterations: Infinity,
        fill: 'both',
      }))
    }
  }

  const motion = resolved.motion === undefined ? undefined : pack.motions?.[resolved.motion]
  if (motion !== undefined && motion.track.length > 0) {
    const animation = figure.animate(motionFrames(motion), {
      duration: motion.duration * 1000,
      easing: motion.easing ?? 'ease',
      iterations: motion.once === true ? 1 : Infinity,
      fill: motion.once === true ? 'forwards' : 'both',
    })
    running.push(animation)
    if (motion.once === true) finished = animation.finished.then(() => {}, () => {})
  }

  if (running.length === 0) return IDLE_PLAYBACK
  return {
    stop: () => { for (const animation of running) animation.cancel() },
    finished,
  }
}

/**
 * Play the pack's click reaction once.
 *
 * `fill: 'none'` is deliberate: the reaction and the state's own motion both
 * drive `transform`, and the reaction wins because it starts later. Leaving it
 * filled would keep the finished reaction — frozen at its last keyframe —
 * overriding the state's motion forever after one click.
 * @param figure - the element to animate.
 * @param pack - the pack declaring the reaction motion.
 * @returns the reaction's completion, or `undefined` when the pack declares none.
 */
export function playReaction(figure: HTMLElement, pack: SpritePack): Promise<void> | undefined {
  const name = pack.reaction?.motion
  const motion = name === undefined ? undefined : pack.motions?.[name]
  if (motion === undefined || motion.track.length === 0) return undefined
  const animation = figure.animate(motionFrames(motion), {
    duration: motion.duration * 1000,
    easing: motion.easing ?? 'ease',
    iterations: 1,
    fill: 'none',
  })
  return animation.finished.then(() => {}, () => {})
}
