/**
 * On-disk store for installed sprite packs.
 *
 * One directory per pack under the harness home —
 * `$DSH_HOME/moegirl/packs/<id>/` holding `pack.json` beside its atlas image —
 * plus `active.json` naming the pack the sprite renders. The document on disk
 * keeps `atlas.src` as the bare file name, and whoever serves it rewrites that
 * one field to a URL, so the same file installs, exports, and reloads without a
 * translation step in between.
 *
 * Nothing here trusts its input. Every document is validated with the same
 * {@link validatePack} the browser half runs on load, so a pack the store
 * accepts is a pack the sprite can render.
 *
 * @module dsh-moegirl/pack-store
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { validatePack, type SpritePack } from './pack-format.ts'
import type { PackSummary } from './pack-api.ts'

/** Atlas media types an install accepts, mapped to the extension stored on disk. */
const ATLAS_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/** Extension back to media type, for serving a stored atlas. */
const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
}

/** One installed pack, with the facts its atlas file carries. */
export interface InstalledPack {
  /** The validated document, with `atlas.src` still the bare on-disk file name. */
  pack: SpritePack
  /** Stored atlas file name, media type, byte length, and modification time. */
  atlas: { file: string; type: string; bytes: number; modified: number }
}

/** Install outcome: the stored id, or why the document was refused. */
export type InstallResult =
  | { ok: true; id: string; reusedAtlas: boolean }
  | { ok: false; error: string }

/** Refusal that reads as a sentence for whoever authored the document. */
class StoreError extends Error {}

/**
 * Resolve `$DSH_HOME`, the single root harness plugins keep user data under.
 * Precedence is the configured path, then `$DSH_HOME`, then `~/.dsh`; a blank
 * environment value counts as unset, so it never lands data in the current
 * directory.
 * @param configured - explicit root from plugin config.
 * @returns the absolute store root.
 */
export function resolveStoreRoot(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return resolve(configured)
  const fromEnv = (process.env.DSH_HOME ?? '').trim()
  return resolve(fromEnv === '' ? join(homedir(), '.dsh') : fromEnv, 'moegirl')
}

/** Write through a uniquely named temporary file so a reader never sees a half-written document. */
async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  await writeFile(temporary, data)
  await rename(temporary, path)
}

/**
 * Decode a base64 data URL into its media type and bytes.
 * @param source - the `atlas.src` value from an uploaded document.
 * @returns the media type and decoded bytes.
 * @throws when the value is not a base64 image data URL.
 */
function decodeDataUrl(source: string): { type: string; bytes: Buffer } {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.*)$/is.exec(source)
  if (match === null) throw new StoreError('atlas.src must be a base64 image data URL when installing a new atlas')
  const type = (match[1] ?? '').toLowerCase()
  if (ATLAS_TYPES[type] === undefined) throw new StoreError(`atlas media type "${type}" is not supported`)
  const bytes = Buffer.from((match[2] ?? '').replace(/\s+/g, ''), 'base64')
  if (bytes.length === 0) throw new StoreError('atlas image is empty')
  return { type, bytes }
}

/** The sprite-pack store rooted at one directory. */
export class PackStore {
  /** Absolute root; holds `packs/` and `active.json`. */
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  /** Directory holding one subdirectory per installed pack. */
  get packsDir(): string {
    return join(this.root, 'packs')
  }

  /** One pack's directory. */
  private dir(id: string): string {
    return join(this.packsDir, id)
  }

  /** One pack's document path. */
  private document(id: string): string {
    return join(this.dir(id), 'pack.json')
  }

  /** The active-pack pointer's path. */
  private activeFile(): string {
    return join(this.root, 'active.json')
  }

  /**
   * A symbolic spelling of the store root for the editor to display.
   * @returns `~/.dsh/moegirl` for the default home, otherwise `$DSH_HOME/moegirl`.
   */
  displayRoot(): string {
    const defaultRoot = resolve(join(homedir(), '.dsh', 'moegirl'))
    return this.root === defaultRoot ? '~/.dsh/moegirl' : '$DSH_HOME/moegirl'
  }

  /**
   * Read one installed pack.
   * @param id - pack id, validated by the document itself.
   * @returns the pack and its atlas facts, or `undefined` when absent or unreadable.
   */
  async read(id: string): Promise<InstalledPack | undefined> {
    let raw: string
    try {
      raw = await readFile(this.document(id), 'utf8')
    } catch {
      return undefined
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
    const validation = validatePack(parsed)
    if (!validation.ok) return undefined
    const pack = validation.pack
    // A directory and its document can disagree if one was hand-edited; the
    // directory wins, so a stale id never writes outside its own folder.
    if (pack.id !== id) return undefined
    const file = pack.atlas.src
    let facts
    try {
      facts = await stat(join(this.dir(id), file))
    } catch {
      return undefined
    }
    if (!facts.isFile()) return undefined
    const extension = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
    return {
      pack,
      atlas: {
        file,
        type: EXTENSION_TYPES[extension] ?? 'application/octet-stream',
        bytes: facts.size,
        modified: Math.floor(facts.mtimeMs),
      },
    }
  }

  /**
   * List every installed pack whose document and atlas both read back.
   * @returns summaries in directory order; unreadable entries are skipped.
   */
  async list(): Promise<PackSummary[]> {
    let entries: string[]
    try {
      entries = await readdir(this.packsDir)
    } catch {
      return []
    }
    const summaries: PackSummary[] = []
    for (const id of entries.sort()) {
      const installed = await this.read(id)
      if (installed === undefined) continue
      summaries.push({
        id: installed.pack.id,
        name: installed.pack.name,
        frame: installed.pack.frame,
        atlasCount: installed.pack.atlas.count,
        frames: Object.keys(installed.pack.frames),
        states: Object.keys(installed.pack.states),
        bytes: installed.atlas.bytes,
      })
    }
    return summaries
  }

  /**
   * Install or replace a pack from a document.
   *
   * `atlas.src` is either a base64 data URL carrying a new image, or the file
   * name of the atlas already installed under this id when the caller is only
   * editing frames, motions, or copy.
   * @param document - the parsed document to install.
   * @returns the stored id, or the reason the document was refused.
   */
  async install(document: unknown): Promise<InstallResult> {
    try {
      const validation = validatePack(document)
      if (!validation.ok) throw new StoreError(validation.error)
      const pack = validation.pack
      const dir = this.dir(pack.id)
      await mkdir(dir, { recursive: true })

      let file = pack.atlas.src
      let reusedAtlas = false
      if (file.startsWith('data:')) {
        const { type, bytes } = decodeDataUrl(file)
        file = `atlas.${ATLAS_TYPES[type] ?? 'png'}`
        await writeAtomic(join(dir, file), bytes)
      } else {
        // Reusing the installed image: the file has to actually be there, or
        // the pack would save into a state its own loader refuses.
        if (file.includes('/') || file.includes('\\')) {
          throw new StoreError('atlas.src must be a bare file name or a base64 image data URL')
        }
        try {
          const facts = await stat(join(dir, file))
          if (!facts.isFile()) throw new StoreError(`atlas "${file}" is not a file`)
        } catch (error) {
          if (error instanceof StoreError) throw error
          throw new StoreError(`atlas "${file}" is not installed for pack "${pack.id}"`)
        }
        reusedAtlas = true
      }

      const stored: SpritePack = { ...pack, atlas: { src: file, count: pack.atlas.count } }
      await writeAtomic(this.document(pack.id), `${JSON.stringify(stored, null, 2)}\n`)
      return { ok: true, id: pack.id, reusedAtlas }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Remove one installed pack and its atlas.
   * @param id - pack id.
   * @returns whether a directory was removed.
   */
  async remove(id: string): Promise<boolean> {
    if (id.includes('/') || id.includes('\\') || id === '.' || id === '..') return false
    const existed = (await this.read(id)) !== undefined
    await rm(this.dir(id), { recursive: true, force: true })
    if ((await this.active()) === id) await rm(this.activeFile(), { force: true })
    return existed
  }

  /**
   * Read the active pack's id.
   * @returns the pointer value, or `undefined` when unset or unreadable.
   */
  async active(): Promise<string | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.activeFile(), 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const id = (parsed as { id?: unknown }).id
      return typeof id === 'string' && id !== '' ? id : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Point the sprite at one installed pack.
   * @param id - pack id; must already be installed and readable.
   * @returns whether the pointer moved.
   */
  async setActive(id: string): Promise<boolean> {
    if ((await this.read(id)) === undefined) return false
    await mkdir(this.root, { recursive: true })
    await writeAtomic(this.activeFile(), `${JSON.stringify({ id }, null, 2)}\n`)
    return true
  }

  /**
   * Clear the active pointer, so the sprite falls back to the built-in pack.
   *
   * "Stop using an installed pack" has to be an operation of its own: a pack can
   * stay installed and editable while the corner renders the shipped look, and
   * reaching that state by deleting the pack would throw its files away.
   * @returns whether a pointer file was there to remove.
   */
  async clearActive(): Promise<boolean> {
    let existed = true
    try {
      await stat(this.activeFile())
    } catch {
      existed = false
    }
    await rm(this.activeFile(), { force: true })
    return existed
  }

  /**
   * Read the active pack's document.
   * @returns the installed pack, or `undefined` when nothing valid is active.
   */
  async readActive(): Promise<InstalledPack | undefined> {
    const id = await this.active()
    return id === undefined ? undefined : this.read(id)
  }
}
