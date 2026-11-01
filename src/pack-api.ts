/**
 * The HTTP surface shared by both halves of the plugin: the route prefix, the
 * path builders, and the JSON shapes that cross it.
 *
 * Both halves import this, so a path is spelled once and a renamed field breaks
 * the typecheck instead of the sprite. Nothing here touches Node or the DOM.
 *
 * @module dsh-moegirl/pack-api
 */

/** Path prefix claimed on the harness web server. */
export const PACK_ROUTE_PREFIX = '/moegirl'

/** `GET` the installed pack list and which one is active. */
export const PACK_LIST_PATH = `${PACK_ROUTE_PREFIX}/packs`

/** `GET` the active pack's document; `404` when no installed pack is active. */
export const PACK_ACTIVE_PATH = `${PACK_ROUTE_PREFIX}/packs/active`

/**
 * The active-pointer route: `POST` `{ id }` to point the sprite at one installed
 * pack, `DELETE` to clear the pointer so it renders the built-in pack instead.
 *
 * Clearing is not the same as deleting a pack: the installed pack keeps its
 * files and stays editable, and only the corner changes.
 */
export const PACK_ACTIVATE_PATH = `${PACK_ROUTE_PREFIX}/active`

/** `GET` today's spend, read from the account balance by the host half. */
export const SPEND_PATH = `${PACK_ROUTE_PREFIX}/spend`

/**
 * The document route for one pack: `GET` to read, `PUT` to install or replace,
 * `DELETE` to remove.
 * @param id - pack id.
 * @returns the absolute route path.
 */
export function packDocumentPath(id: string): string {
  return `${PACK_ROUTE_PREFIX}/packs/${encodeURIComponent(id)}`
}

/**
 * The atlas image route for one pack.
 * @param id - pack id.
 * @returns the absolute route path.
 */
export function packAtlasPath(id: string): string {
  return `${packDocumentPath(id)}/atlas`
}

/**
 * The self-contained download route for one pack, with its atlas inlined as a
 * data URL so the single file is the whole installable resource.
 * @param id - pack id.
 * @returns the absolute route path.
 */
export function packExportPath(id: string): string {
  return `${packDocumentPath(id)}/export`
}

/** What the pack list reports about one installed pack. */
export interface PackSummary {
  /** Pack identity, which is also its directory name. */
  id: string
  /** Human-readable name. */
  name: string
  /** One frame's source size. */
  frame: { width: number; height: number }
  /** Atlas row count. */
  atlasCount: number
  /** Named frames, in declaration order. */
  frames: readonly string[]
  /** State ids, in declaration order. */
  states: readonly string[]
  /** Atlas byte length. */
  bytes: number
}

/** `GET` {@link PACK_LIST_PATH} response body. */
export interface PackListResponse {
  /** Active pack id, absent when the sprite is rendering the built-in pack. */
  active?: string
  /** Store root spelled symbolically (`~/.dsh/moegirl`). */
  root: string
  /** Every installed pack. */
  packs: PackSummary[]
}

/** Failure body every route returns alongside a 4xx or 5xx status. */
export interface PackErrorResponse {
  /** Message written for whoever authored the document. */
  error: string
}
