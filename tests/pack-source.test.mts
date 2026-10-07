/**
 * pack-source 的行为检查：成功加载会发布、失败会退回内置包、图集预载不会卡住。
 *
 * 这是「编辑器改完不用刷新页面」那条链的关键一环 —— 精灵通过
 * useSyncExternalStore 订阅这个模块，所以「发布」就等于「重绘」。
 *
 * 这个模块是浏览器模块（用 fetch 和 Image），所以测试要先把这两个全局补上。
 *
 * 跑法（需要 TS 加载器；本机可在 deepseek-harness 检出里跑）：
 *
 *     cd ~/GitHub/deepseek-harness
 *     node --import tsx/esm ~/projects/dhs-moegirl/tests/pack-source.test.mts
 */

const results: boolean[] = []
const check = (label: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  → ${detail}`}`)
}

/** 这一轮 fetch 要返回什么。 */
let nextResponse: { status: number; body?: unknown } = { status: 404 }

globalThis.fetch = (async () => {
  const { status, body } = nextResponse
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}) as unknown as typeof fetch

/** 图集预载用的 Image 替身：可配置成加载成功、失败，或永远不回应。 */
let imageBehavior: 'load' | 'error' | 'hang' = 'load'
let createdImages = 0
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    createdImages += 1
    if (imageBehavior === 'load') queueMicrotask(() => { this.onload?.() })
    if (imageBehavior === 'error') queueMicrotask(() => { this.onerror?.() })
  }
}
(globalThis as unknown as { Image: unknown }).Image = FakeImage

const { refreshPack, currentPack, subscribePack } = await import('../src/client/pack-source.ts')
const { DEFAULT_PACK } = await import('../src/sprite-pack.ts')

/** 一个最小的合法包文档。 */
const installed = {
  format: 'dsh-moegirl/pack',
  version: 1,
  id: 'installed',
  name: '装上的包',
  frame: { width: 8, height: 16 },
  atlas: { src: '/moegirl/packs/installed/atlas?v=1', count: 1 },
  frames: { idle: 0 },
  states: { idle: { frame: 'idle', bubble: { zh: '嗨' } } },
  fallback: 'idle',
}

check('初始就是内置包', currentPack() === DEFAULT_PACK, currentPack().id)

// 订阅者收到通知是「精灵重绘」的前提。
let notifications = 0
subscribePack(() => { notifications += 1 })

nextResponse = { status: 200, body: installed }
let result = await refreshPack()
check('加载成功会发布装上的包', currentPack().id === 'installed' && result.installed === true,
  `${currentPack().id} / installed=${String(result.installed)}`)
check('订阅者收到通知', notifications === 1, `收到 ${notifications} 次`)
check('发布了整份文档（帧与气泡都在）',
  currentPack().frames.idle === 0 && currentPack().states.idle?.bubble.zh === '嗨')
check('发布前预载了图集', createdImages > 0, `创建了 ${createdImages} 个 Image`)

// 同一个包再发布一次不应该惊动订阅者（否则精灵会无谓重启动画）。
const before = notifications
await refreshPack()
check('同样内容不重复通知', notifications === before, `${before} → ${notifications}`)

// 切回内置包的路径：宿主返回 404。
nextResponse = { status: 404 }
result = await refreshPack()
check('404 退回内置包', currentPack() === DEFAULT_PACK && result.installed === false, currentPack().id)
check('退回也通知了订阅者', notifications === before + 1, `收到 ${notifications} 次`)

// 文档不合法：保留上一个有效状态并报错。
nextResponse = { status: 200, body: { ...installed, frames: { idle: 99 } } }
result = await refreshPack()
check('非法文档被拒绝并报错',
  currentPack() === DEFAULT_PACK && result.installed === false && typeof result.error === 'string',
  result.error ?? '')

// 图集永远不回应：预载必须有上限，否则精灵会卡在旧包上。
nextResponse = { status: 200, body: installed }
imageBehavior = 'hang'
const started = Date.now()
result = await refreshPack()
const waited = Date.now() - started
check('图集不回应时仍然发布（有超时上限）',
  currentPack().id === 'installed' && waited < 6000, `等了 ${waited}ms`)
check('超时路径也回报成功', result.installed === true)

// 图集加载失败同样不能卡住。
imageBehavior = 'error'
nextResponse = { status: 404 }
await refreshPack()
check('图集报错时也能退回内置包', currentPack() === DEFAULT_PACK)

const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed === 0 ? 0 : 1)
