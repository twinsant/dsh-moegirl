/**
 * The pack HTTP routes served on the harness web server.
 *
 * One prefix route owns everything under `/moegirl`, so the sprite can load an
 * installed pack and the editor can list, install, activate, export, and delete
 * them without a second service. The handler owns its full response lifecycle,
 * as the web server contract requires, and answers JSON on every path.
 *
 * @module dsh-moegirl/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PACK_ROUTE_PREFIX,
  packAtlasPath,
  packDocumentPath,
  packExportPath,
  type PackErrorResponse,
  type PackListResponse,
} from './pack-api.ts'
import type { SpendSnapshot } from './spend.ts'
import type { PackStore } from './pack-store.ts'
import type { SpritePack } from './pack-format.ts'

/** Ceiling for one uploaded document; a base64 atlas dominates the size. */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/** Send a JSON body with a status. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(text))
  // Nothing here is cacheable: the editor re-reads after every write, and a
  // stale pack list is indistinguishable from a failed install.
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

/** Send a refusal in the one shape every route shares. */
function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error } satisfies PackErrorResponse)
}

/**
 * Read the whole request body as UTF-8 text.
 * @param req - the incoming request.
 * @returns the decoded body.
 * @throws when the body exceeds {@link MAX_BODY_BYTES}.
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error(`request body exceeds ${String(MAX_BODY_BYTES)} bytes`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Parse a JSON request body.
 * @param req - the incoming request.
 * @returns the parsed value.
 * @throws when the body is not JSON.
 */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = (await readBody(req)).trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('request body must be JSON')
  }
}

/**
 * Rewrite a stored pack into the document the browser consumes: the one field
 * that differs between disk and wire is `atlas.src`, a bare file name on disk
 * and a fetchable URL with a modification stamp on the wire.
 * @param pack - the stored document.
 * @param modified - atlas modification time, used as the cache-busting stamp.
 * @returns the wire document.
 */
function toWire(pack: SpritePack, modified: number): SpritePack {
  return { ...pack, atlas: { src: `${packAtlasPath(pack.id)}?v=${String(modified)}`, count: pack.atlas.count } }
}

/** Method and path segments of one request. */
interface RequestShape {
  method: string
  segments: string[]
}

/** Split a request into its method and decoded path segments. */
function shapeOf(req: IncomingMessage): RequestShape | undefined {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const segments = url.pathname.split('/').filter(segment => segment !== '').map(segment => decodeURIComponent(segment))
  if (segments[0] !== PACK_ROUTE_PREFIX.slice(1)) return undefined
  return { method: (req.method ?? 'GET').toUpperCase(), segments: segments.slice(1) }
}

/** Answer one request inside the claimed prefix. */
async function dispatch(
  store: PackStore,
  spend: () => SpendSnapshot,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const shape = shapeOf(req)
  if (shape === undefined) {
    sendError(res, 404, 'not found')
    return
  }
  const { method, segments } = shape
  const [head, second, third] = segments

  // GET /moegirl/spend — today's spend, polled by the sprite bubble.
  if (head === 'spend' && second === undefined && method === 'GET') {
    sendJson(res, 200, spend())
    return
  }

  // GET /moegirl — a self-describing index, so the surface is discoverable
  // without reading the plugin source.
  if (segments.length === 0 && method === 'GET') {
    sendJson(res, 200, {
      root: store.displayRoot(),
      routes: [
        `GET ${PACK_ROUTE_PREFIX}/packs`,
        `GET ${PACK_ROUTE_PREFIX}/packs/active`,
        `GET|PUT|DELETE ${packDocumentPath(':id')}`,
        `GET ${packAtlasPath(':id')}`,
        `GET ${packExportPath(':id')}`,
        `POST|DELETE ${PACK_ROUTE_PREFIX}/active`,
      ],
    })
    return
  }

  if (head === 'packs' && second === undefined && method === 'GET') {
    const active = await store.active()
    // A pointer at a pack that no longer reads back is reported as inactive,
    // which is exactly what the sprite will do.
    const activeReadable = active !== undefined && (await store.read(active)) !== undefined
    const body: PackListResponse = {
      ...(activeReadable && active !== undefined ? { active } : {}),
      root: store.displayRoot(),
      packs: await store.list(),
    }
    sendJson(res, 200, body)
    return
  }

  if (head === 'packs' && second === 'active' && method === 'GET') {
    const installed = await store.readActive()
    if (installed === undefined) {
      sendError(res, 404, 'no installed pack is active')
      return
    }
    sendJson(res, 200, toWire(installed.pack, installed.atlas.modified))
    return
  }

  if (head === 'packs' && second !== undefined && third === undefined) {
    const id = second
    if (method === 'GET') {
      const installed = await store.read(id)
      if (installed === undefined) {
        sendError(res, 404, `pack "${id}" is not installed`)
        return
      }
      sendJson(res, 200, toWire(installed.pack, installed.atlas.modified))
      return
    }
    if (method === 'PUT') {
      let document: unknown
      try {
        document = await readJson(req)
      } catch (error) {
        sendError(res, 400, error instanceof Error ? error.message : String(error))
        return
      }
      if (typeof document === 'object' && document !== null && (document as { id?: unknown }).id !== id) {
        sendError(res, 400, `body id must be "${id}"`)
        return
      }
      const result = await store.install(document)
      if (!result.ok) {
        sendError(res, 400, result.error)
        return
      }
      sendJson(res, 200, result)
      return
    }
    if (method === 'DELETE') {
      const existed = await store.remove(id)
      if (!existed) {
        sendError(res, 404, `pack "${id}" is not installed`)
        return
      }
      sendJson(res, 200, { ok: true, id })
      return
    }
    sendError(res, 405, `${method} is not allowed on ${packDocumentPath(id)}`)
    return
  }

  if (head === 'packs' && second !== undefined && third === 'atlas' && method === 'GET') {
    const installed = await store.read(second)
    if (installed === undefined) {
      sendError(res, 404, `pack "${second}" is not installed`)
      return
    }
    const bytes = await readAtlas(store, second, installed.atlas.file)
    if (bytes === undefined) {
      sendError(res, 404, `atlas for pack "${second}" is unreadable`)
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', installed.atlas.type)
    res.setHeader('Content-Length', bytes.length)
    // The wire URL carries the modification stamp, so this response may be
    // cached hard: a changed atlas arrives under a different URL.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.end(bytes)
    return
  }

  if (head === 'packs' && second !== undefined && third === 'export' && method === 'GET') {
    const installed = await store.read(second)
    if (installed === undefined) {
      sendError(res, 404, `pack "${second}" is not installed`)
      return
    }
    const bytes = await readAtlas(store, second, installed.atlas.file)
    if (bytes === undefined) {
      sendError(res, 404, `atlas for pack "${second}" is unreadable`)
      return
    }
    // The export is the install: one self-contained document whose atlas rides
    // along as a data URL, accepted back verbatim by PUT.
    const document: SpritePack = {
      ...installed.pack,
      atlas: { src: `data:${installed.atlas.type};base64,${bytes.toString('base64')}`, count: installed.pack.atlas.count },
    }
    const text = `${JSON.stringify(document, null, 2)}\n`
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${installed.pack.id}.moegirl.json"`)
    res.setHeader('Content-Length', Buffer.byteLength(text))
    res.setHeader('Cache-Control', 'no-store')
    res.end(text)
    return
  }

  if (head === 'active' && second === undefined && method === 'DELETE') {
    // Idempotent: clearing an already-clear pointer succeeds, so the button in
    // the editor cannot fail just because someone else got there first.
    const removed = await store.clearActive()
    sendJson(res, 200, { ok: true, removed })
    return
  }

  if (head === 'active' && second === undefined && method === 'POST') {
    let body: unknown
    try {
      body = await readJson(req)
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : String(error))
      return
    }
    const id = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined
    if (typeof id !== 'string' || id === '') {
      sendError(res, 400, 'body must be { "id": "<pack id>" }')
      return
    }
    if (!await store.setActive(id)) {
      sendError(res, 404, `pack "${id}" is not installed`)
      return
    }
    sendJson(res, 200, { ok: true, id })
    return
  }

  sendError(res, 404, `no route for ${method} /${PACK_ROUTE_PREFIX}/${segments.join('/')}`)
}

/** Read one pack's atlas bytes, or `undefined` when it vanished after the document read. */
async function readAtlas(store: PackStore, id: string, file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(join(store.packsDir, id, file))
  } catch {
    return undefined
  }
}

/**
 * Build the one handler registered for the plugin's route prefix.
 * @param store - the pack store to serve.
 * @returns the request handler, which never rejects: every failure is a response.
 */
export function createMoegirlHandler(
  store: PackStore,
  spend: () => SpendSnapshot,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await dispatch(store, spend, req, res)
    } catch (error) {
      // A handler that throws after headers are sent cannot be repaired, and
      // the web server owns no error page for a JSON prefix.
      if (!res.headersSent) sendError(res, 500, error instanceof Error ? error.message : String(error))
      else res.end()
    }
  }
}
