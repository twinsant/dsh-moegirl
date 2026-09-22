/**
 * The moegirl desktop sprite: a chibi twin-tail girl floating at the
 * bottom-right corner of the shell overlay, mirroring live agent status.
 * Five moods, highest-priority fact wins — approval (a session blocked on the
 * user's allow/deny decision) > attention (any other pending interaction:
 * plan-review, question) > working (any session running) > done (an off-screen
 * session finished) > idle. Pure presentation: pending interactions arrive
 * through the runtime share's useSessionPendingInteraction hook and session
 * activity through useSessions.
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the 'shell.overlay' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SPRITE_SHEET, SPRITE_FRAME } from '../assets.ts'
import css from './MoegirlSprite.module.css'

/** Extra props this plugin injects into its own shell.overlay entry. */
export interface MoegirlInjected {
  /** Select one session as the current workspace selection. */
  openSession: (sessionId: string) => void
}

/** Full composed props: runtime share (global standard kit), the locale seat, and the injected opener. */
export type MoegirlSpriteProps = PropsRuntime<'shell.overlay'> & PropsLocale<'moegirl'> & MoegirlInjected

/** Sprite mood discriminant, highest-priority live fact wins. */
type Mood = 'idle' | 'working' | 'attention' | 'approval' | 'done'

/** Vertical sprite-sheet frame index per mood (frame 1 is the idle blink). */
const MOOD_FRAME: Record<Mood, number> = { idle: 0, working: 2, attention: 3, done: 4, approval: 5 }

/**
 * Fold the pending-interaction map into one stable primitive: `approval:other`
 * counts on the first line and the session the bubble should open on the
 * second. An `approval` interaction wins the target over any other pending
 * kind, matching the mood precedence; the target is empty when none is pending.
 * The primitive result keeps the snapshot subscription quiet — object results
 * would republish on every map rebuild.
 */
function selectPending(map: ReadonlyMap<string, { kind?: string } | undefined>): string {
  let approval = 0
  let other = 0
  let approvalTarget = ''
  let otherTarget = ''
  for (const [id, interaction] of map) {
    if (interaction === undefined) continue
    if (interaction.kind === 'approval') {
      approval += 1
      if (approvalTarget === '') approvalTarget = String(id)
    } else {
      other += 1
      if (otherTarget === '') otherTarget = String(id)
    }
  }
  return `${approval}:${other}\n${approval > 0 ? approvalTarget : otherTarget}`
}

/**
 * Fold the session list into one stable primitive: `working:done` counts on the
 * first line and the first finished-and-not-yet-open session on the second.
 */
function selectSessions(s: { ids: readonly string[]; byId: Record<string, { running: boolean; completed?: boolean } | undefined> }): string {
  let working = 0
  let done = 0
  let target = ''
  for (const id of s.ids) {
    const row = s.byId[id]
    if (row === undefined) continue
    if (row.running) working += 1
    else if (row.completed === true) {
      done += 1
      if (target === '') target = String(id)
    }
  }
  return `${working}:${done}\n${target}`
}

/**
 * Render the sprite and its speech bubble.
 * @param props - composed slot props (runtime share + locale seat).
 * @returns the sprite element tree.
 */
export function MoegirlSprite({ useSessions, useSessionPendingInteraction, t, openSession }: MoegirlSpriteProps) {
  const [pendingCounts, pendingTarget] = useSessionPendingInteraction(selectPending).split('\n') as [string, string]
  const [sessionCounts, doneTarget] = useSessions(selectSessions).split('\n') as [string, string]
  const [approval, other] = pendingCounts.split(':').map(Number)
  const [working, done] = sessionCounts.split(':').map(Number)
  const mood: Mood = approval > 0 ? 'approval'
    : other > 0 ? 'attention'
      : working > 0 ? 'working'
        : done > 0 ? 'done'
          : 'idle'
  // null = follow the mood's default (approval/attention/done bubble up on their own).
  const [pinned, setPinned] = useState<boolean | null>(null)
  const showBubble = pinned ?? (mood === 'approval' || mood === 'attention' || mood === 'done')
  // The session the bubble opens: whichever fact elected the current mood.
  const jumpTarget = mood === 'approval' || mood === 'attention' ? pendingTarget : mood === 'done' ? doneTarget : ''

  // Click reaction: a quick pop on the sprite + a floating heart emote.
  // `reactKey` bumps the figure's key so the CSS animation replays on every
  // click; `reacting` adds the .reacting class and clears when the pop ends.
  const [reacting, setReacting] = useState(false)
  const [reactKey, setReactKey] = useState(0)
  const triggerReact = () => {
    setReactKey(k => k + 1)
    setReacting(true)
  }

  const count = mood === 'working' ? working : mood === 'attention' ? other : mood === 'approval' ? approval : mood === 'done' ? done : 0

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
      {showBubble && (jumpTarget === ''
        ? (
            <div className={css.bubble} role="status">
              {t(`bubble.${mood}` as never)}
              {mood !== 'idle' && <span className={css.count}>{count} {t('bubble.count.sessions')}</span>}
            </div>
          )
        : (
            <button
              type="button"
              className={`${css.bubble} ${css.openable}`}
              title={t('bubble.open.title')}
              aria-label={`${t(`bubble.${mood}` as never)} ${t('bubble.open.title')}`}
              onClick={() => { openSession(jumpTarget) }}
            >
              {t(`bubble.${mood}` as never)}
              {mood !== 'idle' && <span className={css.count}>{count} {t('bubble.count.sessions')}</span>}
            </button>
          ))}
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
