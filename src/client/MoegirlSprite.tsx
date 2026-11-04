/**
 * The moegirl desktop sprite: a chibi character floating at the bottom-right
 * corner of the shell overlay, mirroring live agent status.
 *
 * Five states, highest-priority fact wins — approval (a session blocked on the
 * user's allow/deny decision) > attention (any other pending interaction:
 * plan-review, question) > working (any session running) > done (a session
 * stopped somewhere the user is not looking) > idle.
 *
 * All of that comes from one hook, `useSessionStatus`, which reports running
 * state, the highest-precedence pending interaction, and unread completion per
 * session. The 0.2 harness folded the two older sources (a session list plus a
 * pending-interaction hook) into it; a plugin still calling the old ones gets
 * `undefined` and throws on render, which is how the sprite silently vanished.
 *
 * Everything visual comes from a sprite pack: which frame a state shows, the
 * frame sequence and transform motion it plays, and what its bubble says. This
 * component only decides which state is current, so a pack can be swapped
 * without touching the plugin.
 */
import { Component, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the 'shell.overlay' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { frameRow, playReaction, playState } from './pack-player.ts'
import { currentPack, subscribePack } from './pack-source.ts'
import { currentSpend, subscribeSpend } from './spend-source.ts'
import css from './MoegirlSprite.module.css'

/** Render a money figure with its wallet symbol. */
function formatMoney(value: number, currency: string): string {
  return `${currency === 'USD' ? '$' : '¥'}${value.toFixed(2)}`
}

/** Extra props this plugin injects into its own shell.overlay entry. */
export interface MoegirlInjected {
  /** Select one session as the current workspace selection. */
  openSession: (sessionId: string) => void
  /**
   * Translator bound to this plugin's namespace.
   *
   * Bound here rather than taken from the framework's `locale` seat: the entry
   * then owns nothing but its own inject face, and a kit assembled without a
   * locale seat can no longer take the sprite down.
   */
  t: PropsLocale<'moegirl'>['t']
}

/** Full composed props: runtime share (global standard kit) plus the injected face. */
export type MoegirlSpriteProps = PropsRuntime<'shell.overlay'> & MoegirlInjected

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
/**
 * One independent UI fact about one session, as the status snapshot reports it.
 *
 * The harness used to expose two separate sources — a session list for activity
 * and a pending-interaction hook for blocked sessions. 0.2 replaced both with
 * this single per-session status, so the sprite folds one map instead of joining
 * two, and `completionUnread` already means "stopped somewhere you are not
 * looking", which is exactly what the `done` mood wants.
 */
interface SessionStatusFact {
  /** Latest known running state; absent until a baseline establishes it. */
  readonly running?: boolean | undefined
  /** Highest-precedence request currently awaiting the user. */
  readonly pendingInteraction?: { readonly kind?: string } | undefined
  /** A stop outside the main view still waiting to be acknowledged. */
  readonly completionUnread?: boolean
}

/**
 * Fold the status map into one stable primitive.
 *
 * `approval:other:working:done` counts on the first line, and the session the
 * bubble should open on the second: an approval target wins over any other
 * pending kind, which wins over a finished session, mirroring the mood
 * precedence. A primitive keeps the snapshot subscription quiet — an object
 * result would republish on every map rebuild.
 * @param statuses - the session status snapshot.
 * @returns the folded primitive.
 */
function selectStatus(statuses: ReadonlyMap<string, SessionStatusFact | undefined>): string {
  let approval = 0
  let other = 0
  let working = 0
  let done = 0
  let approvalTarget = ''
  let otherTarget = ''
  let doneTarget = ''
  for (const [id, status] of statuses) {
    if (status === undefined) continue
    if (status.running === true) working += 1
    if (status.completionUnread === true) {
      done += 1
      if (doneTarget === '') doneTarget = String(id)
    }
    const interaction = status.pendingInteraction
    if (interaction === undefined) continue
    if (interaction.kind === 'approval') {
      approval += 1
      if (approvalTarget === '') approvalTarget = String(id)
    } else {
      other += 1
      if (otherTarget === '') otherTarget = String(id)
    }
  }
  const target = approval > 0 ? approvalTarget : other > 0 ? otherTarget : doneTarget
  return `${approval}:${other}:${working}:${done}\n${target}`
}

/**
 * Render the sprite and its speech bubble.
 * @param props - composed slot props (runtime share + locale seat + injected opener).
 * @returns the sprite element tree.
 */
export function MoegirlSprite(props: MoegirlSpriteProps) {
  return (
    <SpriteBoundary>
      <SpriteBody {...props} />
    </SpriteBoundary>
  )
}

/**
 * Keep a sprite failure on screen instead of letting it vanish.
 *
 * The framework wraps each entry in its own boundary and retires a crashed
 * entry from its cell, permanently. A production React build does not log the
 * caught error either, so a broken sprite simply disappears with no trace
 * anywhere. Catching it here keeps this decorative widget from being retired
 * and shows the reason.
 */
class SpriteBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    console.error('[moegirl] sprite render failed:', error)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    // Deliberately a literal, not a translated key: the translator itself is
    // one of the things that can be missing, and a fallback that needs it would
    // throw in the very situation it exists for.
    return (
      <div className={css.failure} role="status" title={error.message}>
        ⚠ 精灵加载失败 · sprite failed
      </div>
    )
  }
}

/**
 * The sprite proper: the part that can throw, kept separate so the boundary
 * above has something to catch.
 * @param props - composed slot props.
 * @returns the sprite element tree.
 */
function SpriteBody({ useSessionStatus, t, openSession }: MoegirlSpriteProps) {
  // The installed pack when one is active, the built-in resource otherwise.
  // Subscribing rather than prop-drilling keeps the pack out of the slot
  // contract: the editor installs a pack and the sprite follows on its own.
  const pack = useSyncExternalStore(subscribePack, currentPack)
  // A kit can legitimately arrive without this hook: the standard props are
  // assembled per entry from contributions, and an entry that renders before
  // the session contribution lands would otherwise call `undefined` and be
  // retired for good. Absence means "no facts", which is the idle mood.
  const folded = typeof useSessionStatus === 'function' ? useSessionStatus(selectStatus) : '0:0:0:0\n'
  // Today's spend, read from the host's balance ledger. Absent until the first
  // poll answers, and hidden while the account is signed out.
  const spend = useSyncExternalStore(subscribeSpend, currentSpend)
  const [counts, jumpTarget] = folded.split('\n') as [string, string]
  const [approval, other, working, done] = counts.split(':').map(Number)
  const mood: Mood = approval > 0 ? 'approval'
    : other > 0 ? 'attention'
      : working > 0 ? 'working'
        : done > 0 ? 'done'
          : 'idle'
  // null = follow the state's default (approval/attention/done bubble up on their own).
  const [pinned, setPinned] = useState<boolean | null>(null)
  const showBubble = pinned ?? (mood === 'approval' || mood === 'attention' || mood === 'done')
  // The session the bubble opens: whichever fact elected the current state,
  // already resolved inside the selector so it stays a stable primitive.

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

  let spendTitle: string | undefined
  if (spend !== undefined && spend.available) {
    const money = spend.balance === null
      ? `${t('spend.today')} ${formatMoney(spend.spent, spend.currency)}`
      : `${t('spend.today')} ${formatMoney(spend.spent, spend.currency)} · ${t('spend.balance')} ${formatMoney(spend.balance, spend.currency)}`
    // The host may predate the rate field (it is the build the process loaded,
    // not the one on disk): say nothing rather than claim the wrong period.
    let rate = ''
    if (typeof spend.offPeak === 'boolean') {
      rate = ` · ${spend.offPeak ? t('spend.offPeak') : t('spend.peak')}`
      if (spend.nextSwitchAt !== undefined) {
        const at = new Date(spend.nextSwitchAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        rate += ` · ${at} ${t('spend.switchAt')}`
      }
    }
    spendTitle = `${money}${rate}`
  }

  return (
    <div className={css.root} data-mood={mood}>
      {spend !== undefined && spend.available && (
        <div className={css.spend} role="status" title={spendTitle}>
          {typeof spend.offPeak === 'boolean' && (
            <span className={css.spendIcon} aria-hidden>{spend.offPeak ? '🌙' : '☀️'}</span>
          )}
          <span className={css.spendLabel}>{t('spend.today')}</span>
          <span className={css.spendAmount}>{formatMoney(spend.spent, spend.currency)}</span>
        </div>
      )}
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
