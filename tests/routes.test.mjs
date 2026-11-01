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

/** Balance the fake account answers with, in cents; tests move it to simulate spend. */
let balanceCents = 10_000
const fakeAccount = {
  getBalance: async () => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance: (balanceCents / 100).toFixed(2) }],
    bonusWallets: [],
  }),
}

const disposers = []
const ctx = {
  inject: (_deps, callback) => { callback(webCtx) },
  effect: (fn) => { const dispose = fn(); disposers.push(dispose); return () => {} },
  get: (name) => (name === 'deepseekAccount' ? fakeAccount : undefined),
}
// 50ms so the test can observe a second poll without waiting a minute.
apply(ctx, { packsRoot: root, spendPollMs: 50 })
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

// ── 今日花费：账本逻辑 + /spend 路由 ──────────────────────────────────────
const { SpendLedger } = await import(join(REPO, 'lib/index.js'))

// 账本是纯逻辑：注入时钟，单测货币累积规则
{
  let clock = Date.parse('2026-11-01T10:00:00+08:00')
  const file = join(root, 'ledger-unit.json')
  const ledger = new SpendLedger(file, 'CNY', () => clock)
  const read = (cents) => async () => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance: (cents / 100).toFixed(2) }],
  })

  const first = await ledger.refresh(read(10_000))
  check('账本首读只设基准，不算花费', first.spent === 0 && first.balance === 100, JSON.stringify(first))

  clock += 60_000
  const spent1 = await ledger.refresh(read(9_700))
  check('余额下降计入今日花费', spent1.spent === 3, `spent=${spent1.spent}`)

  clock += 60_000
  const topUp = await ledger.refresh(read(50_000))
  check('充值不计入花费，只移动基准', topUp.spent === 3, `spent=${topUp.spent}`)

  clock += 60_000
  const spent2 = await ledger.refresh(read(49_500))
  check('充值后继续累积', spent2.spent === 8, `spent=${spent2.spent}`)

  const restored = new SpendLedger(file, 'CNY', () => clock)
  check('账本跨实例持久化', restored.current().spent === 8, `spent=${restored.current().spent}`)

  clock = Date.parse('2026-11-02T00:01:00+08:00')
  const nextDay = await ledger.refresh(read(49_000))
  check('跨天重置', nextDay.spent === 0 && nextDay.date === '2026-11-02', `${nextDay.date} spent=${nextDay.spent}`)

  const unreachable = await ledger.refresh(async () => null)
  check('账户不可用时不丢失已有数字', unreachable.available === false && unreachable.spent === 0, JSON.stringify(unreachable))
}

// 路由：首轮轮询后 /spend 应带 available + 余额；余额下降后 spent 增长
await new Promise(resolve => setTimeout(resolve, 120))
const spendFirst = await json(await call('GET', '/moegirl/spend'))
check('GET /spend 首轮可用', spendFirst.available === true, JSON.stringify(spendFirst))
check('GET /spend 带货币与余额', spendFirst.currency === 'CNY' && spendFirst.balance === 100, JSON.stringify(spendFirst))

balanceCents = 9_000
await new Promise(resolve => setTimeout(resolve, 180))
const spendSecond = await json(await call('GET', '/moegirl/spend'))
check('余额下降 10 元后 spent 增长到 10', spendSecond.spent === 10, JSON.stringify(spendSecond))
check('GET /spend 禁止缓存', (await call('GET', '/moegirl/spend')).headers['cache-control'] === 'no-store')

// ── 闲时/峰时判定（官方规则：周一至周五 01-04、06-10 UTC 为峰时，节假日除外）──
{
  const { offPeakAt, shanghaiDate } = await import(join(REPO, 'lib/index.js'))
  const at = (iso) => offPeakAt(new Date(iso))
  const peak = (iso) => at(iso).offPeak === false

  check('周一 02:00 UTC 是峰时', peak('2026-11-02T02:00:00Z'), JSON.stringify(at('2026-11-02T02:00:00Z')))
  check('周一 07:00 UTC 是峰时', peak('2026-11-02T07:00:00Z'))
  check('周一 05:00 UTC 空档是闲时', !peak('2026-11-02T05:00:00Z'))
  check('峰时窗口终点 04:00 不算峰时（右开）', !peak('2026-11-02T04:00:00Z'))
  check('峰时窗口起点 01:00 算峰时', peak('2026-11-02T01:00:00Z'))
  check('周一 00:30 UTC 是闲时', !peak('2026-11-02T00:30:00Z'))
  check('周六 02:00 UTC 闲时', !peak('2026-11-07T02:00:00Z'))
  check('周日 07:00 UTC 闲时', !peak('2026-11-01T07:00:00Z'))
  check('春节周一 02:00 UTC 闲时', !peak('2026-02-16T02:00:00Z'))
  check('元旦周四 02:00 UTC 闲时', !peak('2026-01-01T02:00:00Z'))
  check('国庆周一 07:00 UTC 闲时', !peak('2026-10-05T07:00:00Z'))
  check('节后首个工作日恢复峰时', peak('2026-02-24T02:00:00Z'), '2026-02-24 是春节后第一天')

  const before = at('2026-11-02T00:30:00Z')
  check('下次切换时间落在 01:00 UTC', new Date(before.nextSwitchAt).toISOString() === '2026-11-02T01:00:00.000Z', String(before.nextSwitchAt))

  const during = at('2026-11-02T02:00:00Z')
  check('峰时中的下次切换是 04:00 UTC', new Date(during.nextSwitchAt).toISOString() === '2026-11-02T04:00:00.000Z', String(during.nextSwitchAt))

  check('上海日期换算', shanghaiDate(new Date('2026-11-02T16:30:00Z')) === '2026-11-03', shanghaiDate(new Date('2026-11-02T16:30:00Z')))
  check('自定义节假日覆盖内置表', offPeakAt(new Date('2026-11-02T02:00:00Z'), { holidayRanges: [['2026-11-02', '2026-11-02']] }).offPeak === true)
}

// 路由快照要带费率字段
const spendWithRate = await json(await call('GET', '/moegirl/spend'))
check('GET /spend 带 offPeak 布尔值', typeof spendWithRate.offPeak === 'boolean', JSON.stringify(spendWithRate))
check('GET /spend 带下次切换时间', typeof spendWithRate.nextSwitchAt === 'number', String(spendWithRate.nextSwitchAt))

const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed === 0 ? 0 : 1)
