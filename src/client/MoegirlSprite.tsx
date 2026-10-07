/**
 * The moegirl desktop sprite: a chibi character floating at the bottom-right
 * corner of the shell overlay, mirroring live agent status.
 *
 * Five states, highest-priority fact wins — approval (a session blocked on the
 * user's allow/deny decision) > attention (any other pending interaction:
 * plan-review, question) > working (any session running) > done (an off-screen
 * session finished) > idle. Pending interactions arrive through the runtime
 * share's useSessionPendingInteraction hook and session activity through
 * useSessions.
 *
 * Everything visual comes from a sprite pack: which frame a state shows, the
 * frame sequence and transform motion it plays, and what its bubble says. This
 * component only decides which state is current, so a pack can be swapped
 * without touching the plugin.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the 'shell.overlay' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { frameRow, playReaction, playState } from './pack-player.ts'
import { currentPack, subscribePack } from './pack-source.ts'
import css from './MoegirlSprite.module.css'

/** Extra props this plugin injects into its own shell.overlay entry. */
export interface MoegirlInjected {
  /** Select one session as the current workspace selection. */
  openSession: (sessionId: string) => void
}

/** Full composed props: runtime share (global standard kit), the locale seat, and the injected opener. */
export type MoegirlSpriteProps = PropsRuntime<'shell.overlay'> & PropsLocale<'moegirl'> & MoegirlInjected

/** Sprite state discriminant, highest-priority live fact wins. */
type Mood = 'idle' | 'working' | 'attention' | 'approval' | 'done'

/**
 * Fold the pending-interaction map into one stable primitive: `approval:other`
 * counts on the first line and the session the bubble should open on the
 * second. An `approval` interaction wins the target over any other pending
 * kind, matching the state precedence; the target is empty when none is
 * pending. The primitive result keeps the snapshot subscription quiet — object
 * results would republish on every map rebuild.
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
 * @param props - composed slot props (runtime share + locale seat + injected opener).
 * @returns the sprite element tree.
 */
export function MoegirlSprite({ useSessions, useSessionPendingInteraction, t, openSession }: MoegirlSpriteProps) {
  // The installed pack when one is active, the built-in resource otherwise.
  // Subscribing rather than prop-drilling keeps the pack out of the slot
  // contract: the editor installs a pack and the sprite follows on its own.
  const pack = useSyncExternalStore(subscribePack, currentPack)
  const [pendingCounts, pendingTarget] = useSessionPendingInteraction(selectPending).split('\n') as [string, string]
  const [sessionCounts, doneTarget] = useSessions(selectSessions).split('\n') as [string, string]
  const [approval, other] = pendingCounts.split(':').map(Number)
  const [working, done] = sessionCounts.split(':').map(Number)
  const mood: Mood = approval > 0 ? 'approval'
    : other > 0 ? 'attention'
      : working > 0 ? 'working'
        : done > 0 ? 'done'
          : 'idle'
  // null = follow the state's default (approval/attention/done bubble up on their own).
  const [pinned, setPinned] = useState<boolean | null>(null)
  const showBubble = pinned ?? (mood === 'approval' || mood === 'attention' || mood === 'done')
  // The session the bubble opens: whichever fact elected the current state.
  const jumpTarget = mood === 'approval' || mood === 'attention' ? pendingTarget : mood === 'done' ? doneTarget : ''

  const count = mood === 'working' ? working : mood === 'attention' ? other : mood === 'approval' ? approval : mood === 'done' ? done : 0

  const figureRef = useRef<HTMLDivElement>(null)
  const DISPLAY_W = 132
  const DISPLAY_H = Math.round(DISPLAY_W * pack.frame.height / pack.frame.width)

  // Start the state's tracks on every change and tear them down on the way out,
  // so a pack edit or state switch never leaves an orphan animation running.
  useEffect(() => {
    const figure = figureRef.current
    if (figure === null) return
    const playback = playState(figure, pack, mood, DISPLAY_H)
    return () => { playback.stop() }
  }, [pack, mood, DISPLAY_H])

  // Click reaction: the pack's one-shot flourish plus a floating emote. The
  // emote replays by re-mounting on its own key.
  const [reacting, setReacting] = useState(false)
  const [reactKey, setReactKey] = useState(0)
  const triggerReact = () => {
    setReactKey(k => k + 1)
    setReacting(true)
    const figure = figureRef.current
    const finished = figure === null ? undefined : playReaction(figure, pack)
    if (finished === undefined) setReacting(false)
    else void finished.then(() => { setReacting(false) })
  }

  const frame = frameRow(pack, pack.states[mood]?.frame ?? pack.fallback)
  const frameStyle = {
    width: DISPLAY_W,
    height: DISPLAY_H,
    backgroundImage: `url(${pack.atlas.src})`,
    backgroundSize: `${DISPLAY_W}px ${DISPLAY_H * pack.atlas.count}px`,
    backgroundPosition: `0 ${-frame * DISPLAY_H}px`,
  } as CSSProperties

  const bubble = t(`state.${mood}.bubble` as never)

  return (
    <div className={css.root} data-mood={mood}>
      {showBubble && (jumpTarget === ''
        ? (
            <div className={css.bubble} role="status">
              {bubble}
              {mood !== 'idle' && <span className={css.count}>{count} {t('bubble.count.sessions')}</span>}
            </div>
          )
        : (
            <button
              type="button"
              className={`${css.bubble} ${css.openable}`}
              title={t('bubble.open.title')}
              aria-label={`${bubble} ${t('bubble.open.title')}`}
              onClick={() => { openSession(jumpTarget) }}
            >
              {bubble}
              {mood !== 'idle' && <span className={css.count}>{count} {t('bubble.count.sessions')}</span>}
            </button>
          ))}
      <button
        type="button"
        className={css.sprite}
        aria-label={t('sprite.aria')}
        onClick={() => { setPinned(showBubble ? false : true); triggerReact() }}
      >
        <div ref={figureRef} className={css.figure} style={frameStyle} role="img" aria-hidden />
        {reacting && <span key={`emote-${reactKey}`} className={css.emote} aria-hidden>{pack.reaction?.emote ?? ''}</span>}
      </button>
    </div>
  )
}
