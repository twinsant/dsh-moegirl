/**
 * The Desktop sprite settings section: the pack store, and the editor for one
 * pack.
 *
 * The page is the whole install story. It lists what is installed, activates
 * one, imports a sheet into a new pack seeded from the shipped look, and opens
 * the editor on any of them. Saving is a `PUT` to this plugin's own route; the
 * sprite re-reads the active pack on its next load, so activating takes effect
 * on a reload rather than mid-session.
 *
 * @module dsh-moegirl/MoegirlSection
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PackListResponse } from '../pack-api.ts'
import { DEFAULT_PACK } from '../sprite-pack.ts'
import {
  draftFromPack,
  draftFromSheet,
  validateDraft,
  type DraftProblem,
  type PackDraft,
} from './pack-editor.ts'
import {
  activatePack,
  downloadText,
  fetchPackForEdit,
  fetchPackList,
  installPack,
  packDownloadUrl,
  readImageFile,
  removePack,
  useBuiltinPack,
} from './pack-client.ts'
import { refreshPack } from './pack-source.ts'
import { PackEditor } from './PackEditor.tsx'
import css from './MoegirlSection.module.css'

/** Dependencies the section injects into itself. */
export interface MoegirlSectionInjected {
  /** Section copy, bound to the `moegirl` namespace. */
  t: PropsLocale<'moegirl'>['t']
}

/** Props delivered by the settings outlet plus the inject face. */
export type MoegirlSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'moegirl'>
  & MoegirlSectionInjected

/** One line of feedback under the header. */
type Notice = { kind: 'ok' | 'bad'; text: string } | undefined

/**
 * Render the Desktop sprite settings page.
 * @param props - composed slot props plus the inject face.
 * @returns the section tree.
 */
export function MoegirlSection({ t }: MoegirlSectionProps) {
  const [list, setList] = useState<PackListResponse | undefined>(undefined)
  const [notice, setNotice] = useState<Notice>(undefined)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<PackDraft | undefined>(undefined)

  /**
   * Re-read the store, then re-point the sprite at whatever is active now.
   *
   * The second half is what makes the editor live. Every mutation below ends
   * here, so activating, installing, clearing the pointer, and deleting the
   * active pack all reach the corner without a page reload. The sprite subscribes
   * to the pack source, so publishing is enough — nothing is prop-drilled.
   */
  const reload = async (): Promise<PackListResponse | undefined> => {
    setBusy(true)
    const [result, pack] = await Promise.all([fetchPackList(), refreshPack()])
    setBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'bad', text: result.error })
      return undefined
    }
    setList(result.value)
    // The activation itself succeeded; say so rather than leaving a sprite that
    // quietly kept the previous look.
    if (pack.error !== undefined) setNotice({ kind: 'bad', text: `${t('editor.spriteSyncFailed')}${pack.error}` })
    return result.value
  }

  useEffect(() => {
    void (async () => {
      const result = await fetchPackList()
      if (result.ok) setList(result.value)
      else setNotice({ kind: 'bad', text: result.error })
    })()
  }, [])

  // The editor refuses to save an invalid draft, so the page computes the same
  // verdict to disable the button and say why.
  const problem: DraftProblem | undefined = useMemo(() => {
    if (draft === undefined) return undefined
    const check = validateDraft(draft)
    return check.ok ? undefined : check.problem
  }, [draft])

  const openBuiltin = () => {
    // The built-in atlas is already a data URL, so an installed copy of it
    // carries its own image with no extra fetch.
    setDraft(draftFromPack(DEFAULT_PACK, DEFAULT_PACK.atlas.src, true))
    setNotice(undefined)
  }

  const openInstalled = async (id: string) => {
    setBusy(true)
    const result = await fetchPackForEdit(id)
    setBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'bad', text: result.error })
      return
    }
    setDraft(draftFromPack(result.value.pack, result.value.atlasSrc, true))
    setNotice(undefined)
  }

  const importSheet = async (file: File) => {
    const stem = file.name.replace(/\.[^.]+$/, '')
    setBusy(true)
    try {
      const sheet = await readImageFile(file)
      const slug = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
      setDraft(draftFromSheet({
        id: slug === '' ? 'sprite' : slug.slice(0, 64),
        name: stem,
        atlasSrc: sheet.dataUrl,
        imageWidth: sheet.width,
        imageHeight: sheet.height,
      }))
      setNotice({ kind: 'ok', text: `${String(sheet.width)}×${String(sheet.height)}` })
    } catch (error) {
      setNotice({ kind: 'bad', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    if (draft === undefined) return
    const check = validateDraft(draft)
    if (!check.ok) return
    setBusy(true)
    const stored = await installPack(check.pack)
    if (!stored.ok) {
      setBusy(false)
      setNotice({ kind: 'bad', text: stored.error })
      return
    }
    // Installing and activating are one gesture here: a pack nobody renders is
    // indistinguishable from a failed save.
    const activated = await activatePack(stored.value.id)
    setBusy(false)
    if (!activated.ok) {
      setNotice({ kind: 'bad', text: activated.error })
      return
    }
    setNotice({ kind: 'ok', text: t('editor.activated') })
    await reload()
  }

  const exportDraft = () => {
    if (draft === undefined) return
    const check = validateDraft(draft)
    if (!check.ok) return
    downloadText(`${check.pack.id}.moegirl.json`, `${JSON.stringify(check.pack, null, 2)}\n`)
  }

  const activate = async (id: string) => {
    setBusy(true)
    const result = await activatePack(id)
    setBusy(false)
    setNotice(result.ok ? { kind: 'ok', text: t('editor.activated') } : { kind: 'bad', text: result.error })
    await reload()
  }

  // Switching back to the built-in look only clears the pointer: the installed
  // pack keeps its files, so the same row can turn it back on.
  const useBuiltin = async () => {
    setBusy(true)
    const result = await useBuiltinPack()
    setBusy(false)
    setNotice(result.ok ? { kind: 'ok', text: t('editor.builtin.inUse') } : { kind: 'bad', text: result.error })
    await reload()
  }

  const remove = async (id: string) => {
    if (!window.confirm(t('editor.removeConfirm'))) return
    setBusy(true)
    const result = await removePack(id)
    setBusy(false)
    setNotice(result.ok ? { kind: 'ok', text: t('editor.removed') } : { kind: 'bad', text: result.error })
    if (draft?.id === id) setDraft(undefined)
    await reload()
  }

  const installed = list?.packs ?? []
  const activeId = list?.active

  return (
    <div className={css.page}>
      <header className={css.head}>
        <div>
          <h2 className={css.title}>{t('editor.nav')}</h2>
          <p className={css.sub}>
            {t('editor.repo')}: <code>{list?.root ?? '…'}</code>
          </p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => { void reload() }}>{t('editor.refresh')}</Button>
      </header>

      {notice !== undefined && <p className={notice.kind === 'ok' ? css.noticeOk : css.noticeBad}>{notice.text}</p>}

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('editor.builtin')}</h3>
        <p className={css.hint}>{t('editor.builtin.hint')}</p>
        <div className={css.packRow}>
          <span className={css.packName}>{DEFAULT_PACK.name}</span>
          <span className={css.packMeta}>
            <code>{DEFAULT_PACK.id}</code> · {String(DEFAULT_PACK.atlas.count)} {t('editor.frame.count')} · {Object.keys(DEFAULT_PACK.frames).join(', ')}
          </span>
          {activeId === undefined
            ? <span className={css.activeMark}>{t('editor.active')}</span>
            : <Button size="sm" disabled={busy} onClick={() => { void useBuiltin() }}>{t('editor.use.builtin')}</Button>}
          <Button size="sm" onClick={openBuiltin}>{t('editor.copy')}</Button>
        </div>
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('editor.installed')}</h3>
        {list === undefined && <p className={css.hint}>{t('editor.loading')}</p>}
        {list !== undefined && installed.length === 0 && <p className={css.hint}>{t('editor.installed.empty')}</p>}
        {installed.map(pack => (
          <div key={pack.id} className={css.packRow}>
            <span className={css.packName}>{pack.name}</span>
            <span className={css.packMeta}>
              <code>{pack.id}</code> · {pack.frame.width}×{pack.frame.height} · {String(pack.atlasCount)} · {Math.round(pack.bytes / 1024)}KB
            </span>
            {activeId === pack.id
              ? <span className={css.activeMark}>{t('editor.active')}</span>
              : <Button size="sm" disabled={busy} onClick={() => { void activate(pack.id) }}>{t('editor.activate')}</Button>}
            <Button size="sm" disabled={busy} onClick={() => { void openInstalled(pack.id) }}>{t('editor.edit')}</Button>
            <a className={css.linkButton} href={packDownloadUrl(pack.id)} download>{t('editor.export')}</a>
            <Button size="sm" disabled={busy} onClick={() => { void remove(pack.id) }}>{t('editor.remove')}</Button>
          </div>
        ))}
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('editor.sheet')}</h3>
        <div className={css.packRow}>
          <label className={css.fileLabel}>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file !== undefined) void importSheet(file)
              }}
            />
            <span className={css.fileButton}>{t('editor.choose')}</span>
          </label>
          <span className={css.hint}>{t('editor.sheet.hint')}</span>
        </div>
      </section>

      {draft !== undefined && (
        <PackEditor
          draft={draft}
          onChange={setDraft}
          t={t}
          onInstall={() => { void install() }}
          onExport={exportDraft}
          onClose={() => { setDraft(undefined) }}
          busy={busy}
          problem={problem}
        />
      )}
    </div>
  )
}
