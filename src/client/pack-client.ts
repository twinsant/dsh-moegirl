/**
 * The pack routes, called from the settings page.
 *
 * Thin on purpose: every function returns either a value or a message written
 * for the person who will read it on screen, so the page never has to render a
 * rejected promise.
 *
 * @module dsh-moegirl/pack-client
 */
import {
  PACK_ACTIVATE_PATH,
  PACK_LIST_PATH,
  packDocumentPath,
  packExportPath,
  type PackListResponse,
} from '../pack-api.ts'
import type { SpritePack } from '../pack-format.ts'

/** Either the parsed body, or the message to show. */
export type PackCall<T> = { ok: true; value: T } | { ok: false; error: string }

/** Turn any fetch failure into a message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read a JSON error body, falling back to the status line. */
async function failure(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const message = (body as { error?: unknown }).error
      if (typeof message === 'string' && message !== '') return message
    }
  } catch {
    // A non-JSON body is not worth surfacing; the status is.
  }
  return `${String(response.status)} ${response.statusText}`
}

/** Run one JSON request and settle into a {@link PackCall}. */
async function call<T>(path: string, init?: RequestInit): Promise<PackCall<T>> {
  try {
    const response = await fetch(path, {
      headers: { accept: 'application/json', ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }) },
      cache: 'no-store',
      ...init,
    })
    if (!response.ok) return { ok: false, error: await failure(response) }
    return { ok: true, value: (await response.json()) as T }
  } catch (error) {
    return { ok: false, error: describe(error) }
  }
}

/**
 * Read a URL as a data URL.
 * @param url - same-origin resource URL.
 * @returns the resource's bytes as a data URL.
 * @throws when the request fails or the response has no body.
 */
async function readAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`)
  const blob = await response.blob()
  const reader = new FileReader()
  return await new Promise<string>((resolve, reject) => {
    reader.onload = () => { resolve(String(reader.result)) }
    reader.onerror = () => { reject(new Error(`cannot read ${url}`)) }
    reader.readAsDataURL(blob)
  })
}

/**
 * Read one installed pack together with its atlas, ready to edit.
 *
 * The atlas comes back inline as a data URL so the editor can preview it and
 * save it again without the store having to keep a second copy path alive.
 * @param id - pack id.
 * @returns the pack plus its atlas data URL, or the message to show.
 */
export async function fetchPackForEdit(id: string): Promise<PackCall<{ pack: SpritePack; atlasSrc: string }>> {
  const document = await fetchPack(id)
  if (!document.ok) return document
  try {
    return { ok: true, value: { pack: document.value, atlasSrc: await readAsDataUrl(document.value.atlas.src) } }
  } catch (error) {
    return { ok: false, error: describe(error) }
  }
}

/**
 * Read the installed pack list and which one is active.
 * @returns the list response, or the message to show.
 */
export function fetchPackList(): Promise<PackCall<PackListResponse>> {
  return call<PackListResponse>(PACK_LIST_PATH)
}

/**
 * Read one installed pack's document.
 * @param id - pack id.
 * @returns the pack, or the message to show.
 */
export function fetchPack(id: string): Promise<PackCall<SpritePack>> {
  return call<SpritePack>(packDocumentPath(id))
}

/**
 * Install or replace a pack.
 * @param pack - the document to store; `atlas.src` is a data URL for a new
 * atlas, or the installed file name when only the rest changed.
 * @returns the stored id, or the message to show.
 */
export function installPack(pack: SpritePack): Promise<PackCall<{ ok: true; id: string; reusedAtlas: boolean }>> {
  return call(packDocumentPath(pack.id), { method: 'PUT', body: JSON.stringify(pack) })
}

/**
 * Point the sprite at one installed pack.
 * @param id - pack id.
 * @returns the outcome, or the message to show.
 */
export function activatePack(id: string): Promise<PackCall<{ ok: true; id: string }>> {
  return call(PACK_ACTIVATE_PATH, { method: 'POST', body: JSON.stringify({ id }) })
}

/**
 * Clear the active pointer, so the sprite renders the built-in pack again.
 *
 * The installed pack is left untouched: this is "stop using it", not "delete it".
 * @returns the outcome, or the message to show.
 */
export function useBuiltinPack(): Promise<PackCall<{ ok: true; removed: boolean }>> {
  return call(PACK_ACTIVATE_PATH, { method: 'DELETE' })
}

/**
 * Delete one installed pack.
 * @param id - pack id.
 * @returns the outcome, or the message to show.
 */
export function removePack(id: string): Promise<PackCall<{ ok: true; id: string }>> {
  return call(packDocumentPath(id), { method: 'DELETE' })
}

/**
 * The download URL for one installed pack's self-contained document, which is
 * also the file that installs it again elsewhere.
 * @param id - pack id.
 * @returns the route path.
 */
export function packDownloadUrl(id: string): string {
  return packExportPath(id)
}

/**
 * Hand a document to the browser as a file download.
 *
 * Used for the editor's unsaved draft, which never has to touch the store just
 * to be exported.
 * @param filename - suggested file name.
 * @param text - file contents.
 */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Decode an image file into a data URL plus its natural size.
 * @param file - the picked file.
 * @returns the data URL and pixel dimensions.
 * @throws when the browser cannot decode the file as an image.
 */
export async function readImageFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(String(reader.result)) }
    reader.onerror = () => { reject(new Error(`cannot read ${file.name}`)) }
    reader.readAsDataURL(file)
  })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => { resolve(element) }
    element.onerror = () => { reject(new Error(`${file.name} is not an image the browser can decode`)) }
    element.src = dataUrl
  })
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight }
}
