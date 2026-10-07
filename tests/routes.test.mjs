/**
 * 路由与仓库的端到端检查。
 *
 * 用假的 Cordis context 注册真实构建产物 lib/index.js 的 apply，再拿假 req/res
 * 驱动真实 handler —— 所以测的是要跑在 dsh 里的那份东西，不是复制品。
 *
 * 跑法（先把 lib 构建出来）：
 *
 *     cd /Users/twinsant/projects/dhs-moegirl
 *     npm run build
 *     node tests/routes.test.mjs
 *
 * 装到一个临时目录里跑，不碰 ~/.dsh/moegirl 的真实仓库。
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const { apply } = await import(join(REPO, 'lib/index.js'))

const root = await mkdtemp(join(tmpdir(), 'moegirl-routes-'))
const routes = new Map()

const webCtx = {
  effect: (fn) => { fn(); return () => {} },
  webServer: {
    register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) },
  },
}
apply({ inject: (_deps, callback) => { callback(webCtx) } }, { packsRoot: root })
console.log(`仓库 ${root}`)
console.log(`注册的路由 ${[...routes.keys()].join(', ')}\n`)

/** 用一个假的 IncomingMessage / ServerResponse 调一次 handler。 */
function call(method, path, body) {
  const route = routes.get('/moegirl')
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  req.url = path
  req.headers = {}
  return new Promise((resolve) => {
    let status = 0
    const headers = {}
    const chunks = []
    const res = new Proxy({}, {
      get(_target, key) {
        if (key === 'setHeader') return (name, value) => { headers[name.toLowerCase()] = value }
        if (key === 'end') {
          return (data) => {
            if (data !== undefined) chunks.push(Buffer.from(data))
            resolve({ status, headers, body: Buffer.concat(chunks) })
          }
        }
        if (key === 'headersSent') return false
        return undefined
      },
      set(_target, key, value) {
        if (key === 'statusCode') status = value
        return true
      },
    })
    route.handler(req, res)
  })
}

const results = []
const check = (label, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  → ${detail}`}`)
}
const json = async (response) => JSON.parse(response.body.toString('utf8'))

const atlas = `data:image/png;base64,${Buffer.from('fake-png-bytes-for-the-store').toString('base64')}`
const pack = {
  format: 'dsh-moegirl/pack',
  version: 1,
  id: 'test',
  name: 'Test 精灵',
  frame: { width: 10, height: 20 },
  atlas: { src: atlas, count: 2 },
  frames: { idle: 0, blink: 1 },
  sequences: { blink: { steps: true, segments: [{ frame: 'idle', hold: 1 }] } },
  motions: { breathe: { duration: 1, track: [{ at: 0, translateY: 0 }, { at: 1, translateY: -2 }] } },
  states: { idle: { frame: 'idle', sequence: 'blink', motion: 'breathe', bubble: { zh: '嗨' } } },
  fallback: 'idle',
  reaction: { motion: 'breathe', emote: '♥' },
}

// ── 索引与安装 ───────────────────────────────────────────────────────────────
let response = await call('GET', '/moegirl')
const index = await json(response)
check('GET /moegirl 是自描述的', response.status === 200 && index.root === '$DSH_HOME/moegirl')
check('索引列出了内置包的切换方式',
  index.routes.includes('POST|DELETE /moegirl/active'), index.routes.join(' | '))

response = await call('GET', '/moegirl/packs')
check('空仓库', response.status === 200 && (await json(response)).packs.length === 0)

response = await call('PUT', '/moegirl/packs/test', JSON.stringify(pack))
check('安装新包', response.status === 200 && (await json(response)).reusedAtlas === false)

response = await call('GET', '/moegirl/packs/test')
const wire = await json(response)
check('atlas.src 被改写成带时间戳的 URL',
  /^\/moegirl\/packs\/test\/atlas\?v=\d+$/.test(wire.atlas.src), wire.atlas.src)
check('缺省 en 回落成 zh', wire.states.idle.bubble.en === '嗨')

response = await call('GET', wire.atlas.src)
check('图集字节可读', response.status === 200 && response.headers['content-type'] === 'image/png')

// ── 激活 ────────────────────────────────────────────────────────────────────
response = await call('GET', '/moegirl/packs')
check('未激活时列表不带 active', (await json(response)).active === undefined)

response = await call('POST', '/moegirl/active', JSON.stringify({ id: 'test' }))
check('激活', response.status === 200)

response = await call('GET', '/moegirl/packs')
check('激活后列表带 active', (await json(response)).active === 'test')

response = await call('GET', '/moegirl/packs/active')
check('激活后 /packs/active 返回文档', response.status === 200 && (await json(response)).id === 'test')

// ── 切回内置包（这次新加的能力）───────────────────────────────────────────────
response = await call('DELETE', '/moegirl/active')
const cleared = await json(response)
check('DELETE /moegirl/active 清除指针', response.status === 200 && cleared.ok === true && cleared.removed === true,
  JSON.stringify(cleared))

response = await call('GET', '/moegirl/packs/active')
check('清除后 /packs/active 是 404（客户端据此退回内置包）', response.status === 404)

response = await call('GET', '/moegirl/packs')
const afterClear = await json(response)
check('清除后列表报告内置包在用', afterClear.active === undefined)

// 这是「停用」不是「删除」：包本身必须完好无损。
check('清除指针不删包', afterClear.packs.length === 1 && afterClear.packs[0].id === 'test',
  `还剩 ${afterClear.packs.length} 个包`)

response = await call('GET', '/moegirl/packs/test')
check('清除后包文档仍在，且能重新激活', response.status === 200)

response = await call('POST', '/moegirl/active', JSON.stringify({ id: 'test' }))
check('可以重新激活', response.status === 200)

response = await call('DELETE', '/moegirl/active')
check('重复清除是幂等的', response.status === 200 && (await json(response)).removed === true)

response = await call('DELETE', '/moegirl/active')
check('再清一次仍然 200，removed=false', response.status === 200 && (await json(response)).removed === false,
  JSON.stringify(await json(response)))

// ── 校验与错误 ───────────────────────────────────────────────────────────────
response = await call('PUT', '/moegirl/packs/test',
  JSON.stringify({ ...pack, states: { idle: { frame: 'nope', bubble: { zh: 'x' } } } }))
check('未知帧被拒绝并指名', response.status === 400 && (await json(response)).error.includes('not a declared frame'))

response = await call('PUT', '/moegirl/packs/test', JSON.stringify({ ...pack, id: 'other' }))
check('body id 与路径不符被拒绝', response.status === 400)

response = await call('PUT', '/moegirl/packs/bad', '{ not json')
check('坏 JSON 被拒绝', response.status === 400)

response = await call('POST', '/moegirl/active', JSON.stringify({ id: 'ghost' }))
check('激活不存在的包是 404', response.status === 404)

response = await call('GET', '/moegirl/packs/ghost')
check('读不存在的包是 404', response.status === 404)

response = await call('PATCH', '/moegirl/packs/test')
check('不支持的方法 405', response.status === 405)

response = await call('GET', '/moegirl/nope')
check('未知路径 404', response.status === 404)

// ── 导出与删除 ───────────────────────────────────────────────────────────────
response = await call('GET', '/moegirl/packs/test/export')
const exported = await json(response)
check('导出为自包含文档', exported.atlas.src.startsWith('data:image/png;base64,'))
check('导出带下载文件名',
  response.headers['content-disposition'] === 'attachment; filename="test.moegirl.json"')

response = await call('PUT', '/moegirl/packs/test', JSON.stringify(exported))
check('导出的文档能原样装回去', response.status === 200)

response = await call('PUT', '/moegirl/packs/test', JSON.stringify({ ...pack, atlas: { src: 'atlas.png', count: 2 } }))
check('只改动作时复用已有图集', response.status === 200 && (await json(response)).reusedAtlas === true)

await call('POST', '/moegirl/active', JSON.stringify({ id: 'test' }))
response = await call('DELETE', '/moegirl/packs/test')
check('删除', response.status === 200)

response = await call('GET', '/moegirl/packs')
check('删除后列表为空', (await json(response)).packs.length === 0)

response = await call('GET', '/moegirl/packs/active')
check('删掉激活中的包后指针一并失效', response.status === 404)

const stored = await readFile(join(root, 'packs', 'test', 'pack.json'), 'utf8').catch(() => null)
check('删除后磁盘也清干净', stored === null)

const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed === 0 ? 0 : 1)
