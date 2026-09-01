/**
 * The moegirl desktop sprite: a chibi twin-tail girl floating at the
 * bottom-right corner of the shell overlay, mirroring live agent status.
 * Four moods derive from the global session list — attention (a session
 * waits on approval/review/question) > working (any session running) >
 * done (an off-screen session finished) > idle. Pure presentation: every
 * fact arrives through the runtime share's useSessions standard hook.
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the 'shell.overlay' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SPRITE_SHEET, SPRITE_FRAME } from '../assets.ts'
import css from './MoegirlSprite.module.css'

/** Full composed props: runtime share (global standard kit) & the locale seat. */
export type MoegirlSpriteProps = PropsRuntime<'shell.overlay'> & PropsLocale<'moegirl'>

/** Sprite mood discriminant, highest-priority live fact wins. */
type Mood = 'idle' | 'working' | 'attention' | 'done'

/** Vertical sprite-sheet frame index per mood (frame 1 is the idle blink). */
const MOOD_FRAME: Record<Mood, number> = { idle: 0, working: 2, attention: 3, done: 4 }

/**
 * Fold the session list into one stable primitive: `mood:w:a:d` counts.
 * A primitive selector result keeps the snapshot subscription quiet —
 * object results would republish on every list rebuild.
 */
function selectStatus(s: { ids: readonly string[]; byId: Record<string, { running: boolean; pendingInteraction?: unknown; completed?: boolean } | undefined> }): string {
  let working = 0
  let waiting = 0
  let done = 0
  for (const id of s.ids) {
    const row = s.byId[id]
    if (row === undefined) continue
    if (row.pendingInteraction !== undefined) waiting += 1
    else if (row.running) working += 1
    else if (row.completed === true) done += 1
  }
  const mood: Mood = waiting > 0 ? 'attention' : working > 0 ? 'working' : done > 0 ? 'done' : 'idle'
  return `${mood}:${working}:${waiting}:${done}`
}

/**
 * Render the sprite and its speech bubble.
 * @param props - composed slot props (runtime share + locale seat).
 * @returns the sprite element tree.
 */
export function MoegirlSprite({ useSessions, t }: MoegirlSpriteProps) {
  const status = useSessions(selectStatus)
  const [mood, working, waiting, done] = status.split(':') as [Mood, string, string, string]
  // null = follow the mood's default (attention/done bubble up on their own).
  const [pinned, setPinned] = useState<boolean | null>(null)
  const showBubble = pinned ?? (mood === 'attention' || mood === 'done')

  // Click reaction: a quick pop on the sprite + a floating heart emote.
  // `reactKey` bumps the figure's key so the CSS animation replays on every
  // click; `reacting` adds the .reacting class and clears when the pop ends.
  const [reacting, setReacting] = useState(false)
  const [reactKey, setReactKey] = useState(0)
  const triggerReact = () => {
    setReactKey(k => k + 1)
    setReacting(true)
  }

  const count = mood === 'working' ? working : mood === 'attention' ? waiting : mood === 'done' ? done : '0'

  const frame = MOOD_FRAME[mood] ?? 0
  const DISPLAY_W = 132
  const DISPLAY_H = Math.round(DISPLAY_W * SPRITE_FRAME.height / SPRITE_FRAME.width)
  const frameStyle = {
    width: DISPLAY_W,
    height: DISPLAY_H,
    backgroundImage: `url(${SPRITE_SHEET})`,
    backgroundSize: `${DISPLAY_W}px ${DISPLAY_H * SPRITE_FRAME.count}px`,
    backgroundPosition: `0 ${-frame * DISPLAY_H}px`,
    // Frame height in display px, consumed by the CSS blink keyframe to
    // shift background-position-y to the closed-eyes frame (1).
    '--frame-h': `${DISPLAY_H}px`,
  } as CSSProperties

  return (
    <div className={css.root} data-mood={mood}>
      {showBubble && (
        <div className={css.bubble} role="status">
          {t(`bubble.${mood}` as never)}
          {mood !== 'idle' && <span className={css.count}>{count} {t('bubble.count.sessions')}</span>}
        </div>
      )}
      <button
        type="button"
        className={css.sprite}
        aria-label={t('sprite.aria')}
        onClick={() => { setPinned(showBubble ? false : true); triggerReact() }}
      >
        <div
          key={reactKey}
          className={reacting ? `${css.figure} ${css.reacting}` : css.figure}
          style={frameStyle}
          role="img"
          aria-hidden
          onAnimationEnd={() => setReacting(false)}
        />
        {reacting && <span key={`emote-${reactKey}`} className={css.emote} aria-hidden>♥</span>}
      </button>
    </div>
  )
}
