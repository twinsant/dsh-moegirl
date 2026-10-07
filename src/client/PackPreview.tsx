/**
 * Live preview of a draft pack.
 *
 * It renders through the same player the sprite uses, on the same kind of
 * element, so what the editor shows is what the corner will do. The preview
 * reads the draft directly: nothing has to be saved, and an edit that breaks
 * the pack shows up here before it can reach the store.
 *
 * @module dsh-moegirl/PackPreview
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SpritePack } from '../pack-format.ts'
import { frameRow, playReaction, playState } from './pack-player.ts'
import css from './MoegirlSection.module.css'

/** Props of {@link PackPreview}. */
export interface PackPreviewProps {
  /** The pack to draw, already projected from the draft. */
  pack: SpritePack
  /** State id to preview. */
  state: string
  /** A string that changes whenever the draft does, so tracks restart on edit. */
  revision: string
  /** Rendered width in px; height follows the pack's frame proportions. */
  width?: number
  /** Copy for the click control and the explanatory note. */
  labels: { react: string; hint: string }
}

/**
 * Render the preview figure with an emote layer.
 * @param props - the pack, the state, and the revision stamp.
 * @returns the preview element tree.
 */
export function PackPreview({ pack, state, revision, width = 156, labels }: PackPreviewProps) {
  const figureRef = useRef<HTMLDivElement>(null)
  const [emoteKey, setEmoteKey] = useState(0)
  const [emoting, setEmoting] = useState(false)
  const height = Math.max(1, Math.round(width * pack.frame.height / pack.frame.width))

  // Same contract as the sprite: restart on every change, stop on the way out,
  // so a half-edited keyframe cannot leave an animation running behind the UI.
  useEffect(() => {
    const figure = figureRef.current
    if (figure === null) return
    const playback = playState(figure, pack, state, height)
    return () => { playback.stop() }
  }, [pack, state, revision, height])

  const react = () => {
    setEmoteKey(key => key + 1)
    setEmoting(true)
    const figure = figureRef.current
    const finished = figure === null ? undefined : playReaction(figure, pack)
    if (finished === undefined) setEmoting(false)
    else void finished.then(() => { setEmoting(false) })
  }

  const frame = frameRow(pack, pack.states[state]?.frame ?? pack.fallback)
  const frameStyle = {
    width,
    height,
    backgroundImage: `url(${pack.atlas.src})`,
    backgroundSize: `${width}px ${height * pack.atlas.count}px`,
    backgroundPosition: `0 ${-frame * height}px`,
  } as CSSProperties

  return (
    <div className={css.preview}>
      <div className={css.previewStage}>
        <div ref={figureRef} className={css.previewFigure} style={frameStyle} role="img" aria-hidden />
        {emoting && <span key={`emote-${String(emoteKey)}`} className={css.previewEmote} aria-hidden>{pack.reaction?.emote ?? ''}</span>}
      </div>
      <div className={css.previewActions}>
        <button type="button" className={css.previewButton} onClick={react}>{labels.react}</button>
      </div>
      <p className={css.previewNote}>{labels.hint}</p>
    </div>
  )
}
