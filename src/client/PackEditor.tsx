/**
 * The pack editor: art, states, motions, and sequences for one draft.
 *
 * Three deliberate choices shape this UI. It edits tables rather than a drag
 * timeline, because a motion is a short list of numbers and a number box is
 * exact. It previews through the same player as the sprite, so nothing is
 * validated twice. And it mutates a draft that the page owns, so a half-typed
 * keyframe never reaches the store.
 *
 * @module dsh-moegirl/PackEditor
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PackMotion, PackMotionKey, PackSequence } from '../pack-format.ts'
import {
  MOODS,
  packFromDraft,
  renameKey,
  type DraftProblem,
  type PackDraft,
} from './pack-editor.ts'
import { PackPreview } from './PackPreview.tsx'
import css from './MoegirlSection.module.css'

/** Props of {@link PackEditor}. */
export interface PackEditorProps {
  /** The draft being edited. */
  draft: PackDraft
  /** Replace the draft. */
  onChange: (draft: PackDraft) => void
  /** Section copy. */
  t: PropsLocale<'moegirl'>['t']
  /** Install (or replace) the pack and activate it. */
  onInstall: () => void
  /** Download the draft as an installable document. */
  onExport: () => void
  /** Leave the editor without saving. */
  onClose: () => void
  /** True while a request is in flight. */
  busy: boolean
  /** Why the draft is not installable yet, when it is not. */
  problem: DraftProblem | undefined
}

/** The editor's four panes. */
type Tab = 'art' | 'states' | 'motions' | 'sequences'

/**
 * Apply a new frame count.
 *
 * When the sheet's natural height is known, the height re-divides with the
 * count: otherwise the strip under the input would keep showing the old slice
 * and quietly lie about what the pack will render.
 * @param draft - the draft being edited.
 * @param count - the new atlas row count.
 * @returns the updated draft.
 */
function withCount(draft: PackDraft, count: number): PackDraft {
  const image = draft.sourceImage
  if (image === undefined) return { ...draft, count }
  return { ...draft, count, frameHeight: Math.max(1, Math.round(image.height / count)) }
}

/**
 * Number input that keeps the raw text while it is focused.
 *
 * A controlled numeric field cannot express `-` or `0.`, so the text is local
 * and the draft only receives values that already parse.
 */
function NumberBox({ value, onCommit, step = 1, min, max, ariaLabel }: {
  value: number
  onCommit: (value: number) => void
  step?: number
  min?: number
  max?: number
  ariaLabel?: string
}) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(String(value)) }, [value, focused])
  return (
    <input
      className={css.num}
      type="number"
      value={text}
      step={step}
      {...(min !== undefined ? { min } : {})}
      {...(max !== undefined ? { max } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      onFocus={() => { setFocused(true) }}
      onBlur={() => { setFocused(false); setText(String(value)) }}
      onChange={(event) => {
        setText(event.target.value)
        const parsed = Number(event.target.value)
        if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed)
      }}
    />
  )
}

/** Text input that commits on blur or Enter, so a rename is not a keystroke. */
function CommitInput({ value, onCommit, placeholder, ariaLabel }: {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value) }, [value, focused])
  return (
    <input
      className={css.text}
      value={text}
      {...(placeholder !== undefined ? { placeholder } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      onFocus={() => { setFocused(true) }}
      onChange={(event) => { setText(event.target.value) }}
      onBlur={() => { setFocused(false); onCommit(text) }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
    />
  )
}

/** One labelled select over a fixed option list. */
function Select({ label, value, options, onChange, allowEmpty = false }: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  allowEmpty?: boolean
}) {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      <select className={css.select} value={value} onChange={(event) => { onChange(event.target.value) }}>
        {allowEmpty && <option value="">—</option>}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

/** A tile in the frame strip: one atlas row, drawn as the sprite would draw it. */
function FrameTile({ draft, row, roles, active, onPick }: {
  draft: PackDraft
  row: number
  roles: readonly string[]
  active: boolean
  onPick: () => void
}) {
  const width = 46
  const height = Math.max(1, Math.round(width * draft.frameHeight / draft.frameWidth))
  return (
    <button
      type="button"
      className={active ? `${css.tile} ${css.tileActive}` : css.tile}
      title={roles.length === 0 ? `#${String(row + 1)}` : roles.join(', ')}
      onClick={onPick}
    >
      <span
        className={css.tileImage}
        style={{
          width,
          height,
          backgroundImage: `url(${draft.atlasSrc})`,
          backgroundSize: `${width}px ${height * draft.count}px`,
          backgroundPosition: `0 ${-row * height}px`,
        }}
      />
      <span className={css.tileCaption}>{roles[0] ?? `#${String(row + 1)}`}</span>
    </button>
  )
}

/**
 * Render the editor.
 * @param props - the draft, its change handler, and the page's actions.
 * @returns the editor element tree.
 */
export function PackEditor({ draft, onChange, t, onInstall, onExport, onClose, busy, problem }: PackEditorProps) {
  const [tab, setTab] = useState<Tab>('art')
  const [previewState, setPreviewState] = useState<string>(MOODS[0])
  const [focusedState, setFocusedState] = useState<string>(MOODS[0])

  const packs = useMemo(() => packFromDraft(draft), [draft])
  // Restart the preview whenever anything it animates changes. The atlas is
  // deliberately excluded: it arrives as a multi-megabyte data URL, and a new
  // image reaches the DOM through the style prop without restarting a track.
  const revision = useMemo(() => JSON.stringify({
    frame: packs.frame,
    count: packs.atlas.count,
    frames: packs.frames,
    sequences: packs.sequences,
    motions: packs.motions,
    states: packs.states,
    fallback: packs.fallback,
    reaction: packs.reaction,
  }), [packs])
  const frameNames = Object.keys(draft.frames)
  const sequenceNames = Object.keys(draft.sequences)
  const motionNames = Object.keys(draft.motions)

  /** Roles mapped to each atlas row, for the strip. */
  const rolesByRow = useMemo(() => {
    const table: string[][] = Array.from({ length: draft.count }, () => [])
    for (const [name, row] of Object.entries(draft.frames)) {
      if (row >= 0 && row < draft.count) table[row]?.push(name)
    }
    return table
  }, [draft.frames, draft.count])

  /**
   * Point the focused state at one atlas row, creating a role when none exists,
   * so clicking a frame always does the obvious thing.
   */
  const assignRow = (row: number) => {
    const existing = rolesByRow[row]?.[0]
    const name = existing ?? `frame${String(row + 1)}`
    const frames = existing === undefined ? { ...draft.frames, [name]: row } : draft.frames
    const state = draft.states[focusedState]
    if (state === undefined) return
    onChange({ ...draft, frames, states: { ...draft.states, [focusedState]: { ...state, frame: name } } })
  }

  const setState = (id: string, patch: Partial<{ frame: string; sequence: string; motion: string; bubbleZh: string; bubbleEn: string }>) => {
    const current = draft.states[id]
    if (current === undefined) return
    onChange({
      ...draft,
      states: {
        ...draft.states,
        [id]: {
          frame: patch.frame ?? current.frame,
          bubble: {
            zh: patch.bubbleZh ?? current.bubble.zh,
            en: patch.bubbleEn ?? current.bubble.en,
          },
          ...(patch.sequence !== undefined
            ? (patch.sequence === '' ? {} : { sequence: patch.sequence })
            : (current.sequence !== undefined ? { sequence: current.sequence } : {})),
          ...(patch.motion !== undefined
            ? (patch.motion === '' ? {} : { motion: patch.motion })
            : (current.motion !== undefined ? { motion: current.motion } : {})),
        },
      },
    })
  }

  const problemText = problem === undefined ? ''
    : problem.kind === 'atlas' ? t('editor.error.atlas')
      : problem.kind === 'name' ? t('editor.error.name')
        : `${t('editor.error.invalid')}: ${problem.message}`

  return (
    <section className={css.editor}>
      <header className={css.editorBar}>
        <Input
          className={css.grow}
          value={draft.name}
          placeholder={t('editor.name')}
          aria-label={t('editor.name')}
          onChange={(event) => { onChange({ ...draft, name: event.target.value }) }}
        />
        <label className={css.inline}>
          <span className={css.fieldLabel}>{t('editor.id')}</span>
          <Input
            value={draft.id}
            aria-label={t('editor.id')}
            onChange={(event) => { onChange({ ...draft, id: event.target.value.trim() }) }}
          />
        </label>
        <Button variant="primary" size="sm" disabled={busy || problem !== undefined} onClick={onInstall}>
          {t('editor.install')}
        </Button>
        <Button size="sm" disabled={busy || problem !== undefined} onClick={onExport}>
          {t('editor.export')}
        </Button>
        <Button size="sm" onClick={onClose}>{t('editor.close')}</Button>
      </header>

      {problem !== undefined && <p className={css.problem}>{problemText}</p>}

      <div className={css.editorBody}>
        <aside className={css.previewColumn}>
          <PackPreview
            pack={packs}
            state={draft.states[previewState] === undefined ? draft.fallback : previewState}
            revision={revision}
            labels={{ react: t('editor.preview.react'), hint: t('editor.preview.hint') }}
          />
          <div className={css.previewStates}>
            {[...MOODS, ...Object.keys(draft.states).filter(id => !(MOODS as readonly string[]).includes(id))].map(id => (
              <button
                key={id}
                type="button"
                className={previewState === id ? `${css.chip} ${css.chipOn}` : css.chip}
                onClick={() => { setPreviewState(id) }}
              >
                {id}
              </button>
            ))}
          </div>
        </aside>

        <div className={css.panes}>
          <nav className={css.tabs}>
            <button type="button" className={tab === 'art' ? css.tabOn : css.tab} onClick={() => { setTab('art') }}>{t('editor.tab.character')}</button>
            <button type="button" className={tab === 'states' ? css.tabOn : css.tab} onClick={() => { setTab('states') }}>{t('editor.tab.states')}</button>
            <button type="button" className={tab === 'motions' ? css.tabOn : css.tab} onClick={() => { setTab('motions') }}>{t('editor.tab.motions')}</button>
            <button type="button" className={tab === 'sequences' ? css.tabOn : css.tab} onClick={() => { setTab('sequences') }}>{t('editor.tab.sequences')}</button>
          </nav>

          {tab === 'art' && (
            <div className={css.pane}>
              <div className={css.row}>
                <label className={css.inline}>
                  <span className={css.fieldLabel}>{t('editor.frame.width')}</span>
                  <NumberBox value={draft.frameWidth} min={1} ariaLabel={t('editor.frame.width')} onCommit={value => { onChange({ ...draft, frameWidth: value }) }} />
                </label>
                <label className={css.inline}>
                  <span className={css.fieldLabel}>{t('editor.frame.height')}</span>
                  <NumberBox value={draft.frameHeight} min={1} ariaLabel={t('editor.frame.height')} onCommit={value => { onChange({ ...draft, frameHeight: value }) }} />
                </label>
                <label className={css.inline}>
                  <span className={css.fieldLabel}>{t('editor.frame.count')}</span>
                  <NumberBox
                    value={draft.count}
                    min={1}
                    ariaLabel={t('editor.frame.count')}
                    onCommit={value => { onChange(withCount(draft, Math.max(1, Math.round(value)))) }}
                  />
                </label>
                <Button
                  size="sm"
                  disabled={draft.sourceImage === undefined}
                  onClick={() => {
                    const image = draft.sourceImage
                    if (image !== undefined) {
                      onChange({ ...draft, frameHeight: Math.max(1, Math.round(image.height / draft.count)) })
                    }
                  }}
                >
                  {t('editor.frame.slice')}
                </Button>
              </div>

              <div className={css.strip}>
                {Array.from({ length: draft.count }, (_, row) => (
                  <FrameTile
                    key={row}
                    draft={draft}
                    row={row}
                    roles={rolesByRow[row] ?? []}
                    active={draft.states[focusedState]?.frame === rolesByRow[row]?.[0]}
                    onPick={() => { assignRow(row) }}
                  />
                ))}
              </div>

              <label className={css.field}>
                <span className={css.fieldLabel}>{t('editor.states.hint')}</span>
                <select className={css.select} value={focusedState} onChange={(event) => { setFocusedState(event.target.value) }}>
                  {Object.keys(draft.states).map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>

              <table className={css.table}>
                <thead>
                  <tr><th>{t('editor.frames')}</th><th>{t('editor.row')}</th><th /></tr>
                </thead>
                <tbody>
                  {frameNames.map(name => (
                    <tr key={name}>
                      <td>
                        <CommitInput
                          value={name}
                          onCommit={(next) => { onChange({ ...draft, frames: renameKey(draft.frames, name, next) }) }}
                        />
                      </td>
                      <td>
                        <NumberBox
                          value={draft.frames[name] ?? 0}
                          min={0}
                          max={draft.count - 1}
                          onCommit={(row) => { onChange({ ...draft, frames: { ...draft.frames, [name]: Math.max(0, Math.min(draft.count - 1, Math.round(row))) } }) }}
                        />
                      </td>
                      <td>
                        <Button size="sm" onClick={() => {
                          const frames = { ...draft.frames }
                          delete frames[name]
                          onChange({ ...draft, frames })
                        }}>−</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button size="sm" onClick={() => {
                const name = `frame${String(Object.keys(draft.frames).length + 1)}`
                onChange({ ...draft, frames: { ...draft.frames, [name]: 0 } })
              }}>＋</Button>
            </div>
          )}

          {tab === 'states' && (
            <div className={css.pane}>
              <p className={css.hint}>{t('editor.states.hint')}</p>
              {Object.keys(draft.states).map(id => {
                const state = draft.states[id]
                if (state === undefined) return null
                return (
                  <div key={id} className={css.stateCard} onClick={() => { setFocusedState(id) }}>
                    <div className={css.stateHead}>{id}</div>
                    <div className={css.row}>
                      <Select label={t('editor.state.frame')} value={state.frame} options={frameNames} onChange={value => { setState(id, { frame: value }) }} />
                      <Select label={t('editor.state.sequence')} value={state.sequence ?? ''} options={sequenceNames} allowEmpty onChange={value => { setState(id, { sequence: value }) }} />
                      <Select label={t('editor.state.motion')} value={state.motion ?? ''} options={motionNames} allowEmpty onChange={value => { setState(id, { motion: value }) }} />
                    </div>
                    <div className={css.row}>
                      <label className={css.field}>
                        <span className={css.fieldLabel}>{t('editor.state.bubble.zh')}</span>
                        <CommitInput value={state.bubble.zh} onCommit={value => { setState(id, { bubbleZh: value }) }} />
                      </label>
                      <label className={css.field}>
                        <span className={css.fieldLabel}>{t('editor.state.bubble.en')}</span>
                        <CommitInput value={state.bubble.en} onCommit={value => { setState(id, { bubbleEn: value }) }} />
                      </label>
                    </div>
                  </div>
                )
              })}
              <div className={css.row}>
                <Select
                  label={t('editor.fallback')}
                  value={draft.fallback}
                  options={Object.keys(draft.states)}
                  onChange={value => { onChange({ ...draft, fallback: value }) }}
                />
                <Select
                  label={t('editor.reaction.motion')}
                  value={draft.reactionMotion}
                  options={motionNames}
                  allowEmpty
                  onChange={value => { onChange({ ...draft, reactionMotion: value }) }}
                />
                <label className={css.field}>
                  <span className={css.fieldLabel}>{t('editor.reaction.emote')}</span>
                  <CommitInput value={draft.reactionEmote} onCommit={value => { onChange({ ...draft, reactionEmote: value }) }} />
                </label>
              </div>
            </div>
          )}

          {tab === 'motions' && (
            <div className={css.pane}>
              <p className={css.hint}>{t('editor.motions.hint')}</p>
              {motionNames.map(name => {
                const motion = draft.motions[name]
                if (motion === undefined) return null
                const update = (next: PackMotion) => { onChange({ ...draft, motions: { ...draft.motions, [name]: next } }) }
                const setKey = (index: number, patch: Partial<PackMotionKey>) => {
                  const track = motion.track.map((key, at) => (at === index ? { ...key, ...patch } : key))
                  update({ ...motion, track })
                }
                return (
                  <div key={name} className={css.motionCard}>
                    <div className={css.row}>
                      <label className={css.inline}>
                        <CommitInput value={name} onCommit={(next) => { onChange({ ...draft, motions: renameKey(draft.motions, name, next) }) }} />
                      </label>
                      <label className={css.inline}>
                        <span className={css.fieldLabel}>{t('editor.duration')}</span>
                        <NumberBox value={motion.duration} min={0.001} step={0.1} onCommit={value => { update({ ...motion, duration: value }) }} />
                      </label>
                      <label className={css.inline}>
                        <span className={css.fieldLabel}>{t('editor.easing')}</span>
                        <CommitInput value={motion.easing ?? ''} onCommit={value => { update({ ...motion, easing: value === '' ? undefined : value }) }} />
                      </label>
                      <label className={css.checkbox}>
                        <input type="checkbox" checked={motion.once === true} onChange={(event) => { update({ ...motion, once: event.target.checked }) }} />
                        <span>{t('editor.once')}</span>
                      </label>
                      <Button size="sm" onClick={() => {
                        const motions = { ...draft.motions }
                        delete motions[name]
                        onChange({ ...draft, motions })
                      }}>−</Button>
                    </div>
                    <table className={css.table}>
                      <thead>
                        <tr>
                          <th>{t('editor.at')}</th><th>{t('editor.move.y')}</th><th>{t('editor.move.x')}</th>
                          <th>{t('editor.rotate')}</th><th>{t('editor.scale')}</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {motion.track.map((key, index) => (
                          <tr key={index}>
                            <td><NumberBox value={key.at} min={0} max={1} step={0.01} onCommit={value => { setKey(index, { at: value }) }} /></td>
                            <td><NumberBox value={key.translateY ?? 0} step={1} onCommit={value => { setKey(index, { translateY: value }) }} /></td>
                            <td><NumberBox value={key.translateX ?? 0} step={1} onCommit={value => { setKey(index, { translateX: value }) }} /></td>
                            <td><NumberBox value={key.rotate ?? 0} step={0.5} onCommit={value => { setKey(index, { rotate: value }) }} /></td>
                            <td>
                              <NumberBox
                                value={Array.isArray(key.scale) ? key.scale[0] : key.scale ?? 1}
                                step={0.01}
                                onCommit={value => { setKey(index, { scale: value }) }}
                              />
                            </td>
                            <td>
                              <Button size="sm" onClick={() => { update({ ...motion, track: motion.track.filter((_, at) => at !== index) }) }}>−</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Button size="sm" onClick={() => {
                      const last = motion.track[motion.track.length - 1]
                      update({ ...motion, track: [...motion.track, { at: last?.at ?? 0, translateY: last?.translateY ?? 0 }] })
                    }}>{t('editor.key.add')}</Button>
                  </div>
                )
              })}
              <Button size="sm" onClick={() => {
                const name = `motion${String(Object.keys(draft.motions).length + 1)}`
                onChange({
                  ...draft,
                  motions: {
                    ...draft.motions,
                    [name]: { duration: 1, easing: 'ease-in-out', track: [{ at: 0, translateY: 0 }, { at: 1, translateY: -6 }] },
                  },
                })
              }}>{t('editor.motion.add')}</Button>
            </div>
          )}

          {tab === 'sequences' && (
            <div className={css.pane}>
              <p className={css.hint}>{t('editor.sequences.hint')}</p>
              {sequenceNames.map(name => {
                const sequence = draft.sequences[name]
                if (sequence === undefined) return null
                const update = (next: PackSequence) => { onChange({ ...draft, sequences: { ...draft.sequences, [name]: next } }) }
                const total = sequence.segments.reduce((sum, segment) => sum + segment.hold, 0)
                return (
                  <div key={name} className={css.motionCard}>
                    <div className={css.row}>
                      <label className={css.inline}>
                        <CommitInput value={name} onCommit={(next) => { onChange({ ...draft, sequences: renameKey(draft.sequences, name, next) }) }} />
                      </label>
                      <label className={css.checkbox}>
                        <input type="checkbox" checked={sequence.steps !== false} onChange={(event) => { update({ ...sequence, steps: event.target.checked }) }} />
                        <span>{t('editor.steps')}</span>
                      </label>
                      <span className={css.hint}>{total.toFixed(2)}s</span>
                      <Button size="sm" onClick={() => {
                        const sequences = { ...draft.sequences }
                        delete sequences[name]
                        onChange({ ...draft, sequences })
                      }}>−</Button>
                    </div>
                    <table className={css.table}>
                      <thead>
                        <tr><th>{t('editor.state.frame')}</th><th>{t('editor.hold')}</th><th /></tr>
                      </thead>
                      <tbody>
                        {sequence.segments.map((segment, index) => (
                          <tr key={index}>
                            <td>
                              <select
                                className={css.select}
                                value={segment.frame}
                                onChange={(event) => {
                                  const segments = sequence.segments.map((current, at) => (at === index ? { ...current, frame: event.target.value } : current))
                                  update({ ...sequence, segments })
                                }}
                              >
                                {frameNames.map(frame => <option key={frame} value={frame}>{frame}</option>)}
                              </select>
                            </td>
                            <td>
                              <NumberBox
                                value={segment.hold}
                                min={0.001}
                                step={0.05}
                                onCommit={(value) => {
                                  const segments = sequence.segments.map((current, at) => (at === index ? { ...current, hold: value } : current))
                                  update({ ...sequence, segments })
                                }}
                              />
                            </td>
                            <td>
                              <Button size="sm" onClick={() => { update({ ...sequence, segments: sequence.segments.filter((_, at) => at !== index) }) }}>−</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Button size="sm" onClick={() => {
                      update({ ...sequence, segments: [...sequence.segments, { frame: frameNames[0] ?? '', hold: 0.2 }] })
                    }}>{t('editor.segment.add')}</Button>
                  </div>
                )
              })}
              <Button size="sm" onClick={() => {
                const name = `sequence${String(Object.keys(draft.sequences).length + 1)}`
                onChange({
                  ...draft,
                  sequences: { ...draft.sequences, [name]: { steps: true, segments: [{ frame: frameNames[0] ?? '', hold: 0.5 }] } },
                })
              }}>{t('editor.sequence.add')}</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
