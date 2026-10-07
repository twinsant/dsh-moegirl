# dsh-moegirl

DeepSeek Harness（dsh）的桌面精灵插件：在 Web UI 右下角悬浮一只双马尾萌娘，实时反映 agent 的运行状态。人物的动作、帧序列、气泡文案全部出自可安装、可在 Web 界面里编辑的**精灵包**。

<img width="1046" height="311" alt="image" src="https://github.com/user-attachments/assets/593ae249-18b2-4ee7-ae2d-6b454e33b31d" />


## 状态

精灵从全局会话列表推导五种状态，优先级从高到低：

| 状态 | 触发条件 | 内置包的表现 |
|---|---|---|
| 待批准 approval | 有会话卡在允许/拒绝这类审批上 | 等待裁决的小幅摇摆 + 审批气泡 |
| 求关注 attention | 有其他待处理交互（计划评审、提问） | 呼吸 + 气泡 |
| 工作中 working | 有会话正在运行 | 快速跳动 |
| 完成啦 done | 有非选中会话刚刚跑完 | 连续小跳 + 气泡 |
| 摸鱼中 idle | 无任务 | 呼吸 + 眨眼 |

点击精灵可手动展开/收起气泡，并触发一次点击动作；气泡在能定位到会话时是按钮，点它跳到那个会话。

## 精灵包

精灵包是一份 JSON 加一张图集，描述「这一格画什么、哪些格连起来动、动多快、气泡说什么」。插件只管语义（当前是哪个状态、状态怎么排序、点击做什么），包只管表现，两者之间以一个状态 id 为契约。

```jsonc
{
  "format": "dsh-moegirl/pack",
  "version": 1,
  "id": "moegirl",                       // 同时也是安装目录名
  "name": "萌妹精灵",
  "frame": { "width": 384, "height": 667 },
  "atlas": { "src": "atlas.png", "count": 6 },   // 竖排一列，一格一帧
  "frames": { "idle": 0, "blink": 1, "working": 2, "attention": 3, "done": 4, "approval": 5 },
  "sequences": {
    "blink": { "steps": true, "segments": [{ "frame": "idle", "hold": 4.512 }, { "frame": "blink", "hold": 0.288 }] }
  },
  "motions": {
    "breathe": { "duration": 3.2, "easing": "ease-in-out", "track": [{ "at": 0, "translateY": 0 }, { "at": 0.5, "translateY": -2 }, { "at": 1, "translateY": 0 }] }
  },
  "states": {
    "idle": { "frame": "idle", "sequence": "blink", "motion": "breathe", "bubble": { "zh": "现在没有任务，摸摸鱼～", "en": "No tasks right now, taking a break~" } }
  },
  "fallback": "idle",
  "reaction": { "motion": "reaction", "emote": "♥" }
}
```

- `sequences` 驱动 `background-position`，`steps: true` 让它逐帧硬切而不是在两格之间滑动；`motions` 驱动 `transform`，时间点是 0 到 1 的比例。
- 状态 id 固定为 `idle` / `working` / `attention` / `approval` / `done`。包没定义的状态走 `fallback`。
- `atlas.src` 在磁盘上是文件名，**导出**时换成内联的 base64 data URL，所以导出的那一份文件就是完整的可安装资源。
- 装到 `~/.dsh/moegirl/packs/<id>/`（`pack.json` + 图集），`~/.dsh/moegirl/active.json` 指向当前使用的那一个。
- 没有安装任何包、或安装的包读不出来时，精灵退回编译进 bundle 的内置包。

## 编辑器

打开 Web UI 的 **设置 → 桌面精灵**：

- 列出已安装的包，可激活、编辑、导出、删除；
- 选一张竖排精灵图导入，按帧宽/帧高/帧数切分，给每格起语义名；
- 逐个状态指定静止帧、帧序列、动作，并写中英气泡；
- 逐条编辑帧序列的每段帧与停留时间，逐条编辑动作的关键帧、缓动、时长；
- 左侧实时预览，直接跑编辑器里的数据，不必先保存；
- 「安装并激活」写入仓库，**右下角的精灵当场就换**，不用刷新页面；
- 内置包那一行有「使用内置包」，可以把装着的包放下、回到出厂样子（包不会被删）。

每次操作完编辑器都会重新拉一次当前激活的包，精灵通过 `useSyncExternalStore` 订阅
这个来源，所以「发布」就等于「重绘」。切换前会先把图集预载完（有 4 秒上限，
图集坏了也不会卡住），避免换的瞬间空一下。

编辑器的数据模型（分帧猜测、草稿与文档互转、校验）在 `src/client/pack-editor.ts`，不依赖 React，可以单独跑。

## 原理

这是一个 dsh Web GUI 插件，host 与 client 两半：

- `src/index.ts`（host）：把精灵包仓库挂到 `webServer` 的 `/moegirl` 前缀路由上，`GET /moegirl` 会列出全部路由。
  | 路由 | 作用 |
  |---|---|
  | `GET /moegirl/packs` | 已安装列表 + 当前激活的 id + 仓库位置 |
  | `GET /moegirl/packs/active` | 当前激活包的文档（`atlas.src` 已改写成带时间戳的 URL） |
  | `GET /moegirl/packs/<id>` | 某个包的文档 |
  | `GET /moegirl/packs/<id>/atlas` | 图集字节 |
  | `GET /moegirl/packs/<id>/export` | 自包含的可安装文档（图集内联） |
  | `PUT /moegirl/packs/<id>` | 安装或覆盖 |
  | `POST /moegirl/active` | 切换激活的包 |
  | `DELETE /moegirl/active` | 清除激活指针，回到内置包（装着的包不删） |
  | `DELETE /moegirl/packs/<id>` | 删除 |
- `src/client/index.ts` 通过 `ctx.slots.inject('shell.overlay', …)` 把精灵注册进整页浮层（list 型，增量挂载），并通过 `ctx.slots.inject('settings.section', …)` 挂上编辑器页面；
- 页面启动时请求一次 `/moegirl/packs/active`，拿到什么就渲染什么，失败就保留内置包；编辑器里每次改动后再拉一次，所以激活、切换、删除都不用刷新页面；
- 构建产物 `lib/client.js` 遵循 dsh 客户端 bundle 契约：CJS 闭包 + `window.__ModuleLoader__.load({ id, factory })`，React / Cordis / ui-slots / ui-primitives 等平台模块由宿主模块表注入（必须在 tsdown 配置里声明为 rolldown `external`，否则会顺着 tsconfig 路径解析进 harness 的 `.d.ts`）；
- 包声明 `dsh.bundle.patch`，作为 bundle 安装时自带 cordis.patch.yml 插入 Loader 行。

代码分工：`pack-format.ts`（格式、校验器、纯投影，不含图集，host 半可安全导入）、`pack-store.ts`（磁盘仓库）、`routes.ts`（HTTP）、`pack-api.ts`（两端共用的路由契约）、`sprite-pack.ts`（内置包，唯一持有编译期图集）。

## 构建

```sh
pnpm install
pnpm run sync:paths   # 从本地 deepseek-harness 检出生成 tsconfig 路径（DSH_REPO 可覆盖位置）
pnpm run typecheck    # 需要仓库已完成 pnpm run build（消费其 lib/types 声明文件）
pnpm run build        # 产出 lib/index.js 与 lib/client.js
```

## 安装到 profile

```sh
dsh plugin --profile web add file:"$PWD"
dsh --profile web
```

打开 Web UI（默认 http://127.0.0.1:3080 ）即可看到右下角的精灵。修改代码后重新 `pnpm run build`，再执行 `dsh plugin --profile web update dsh-moegirl`（或重新 add）并刷新页面。

装好的 profile 副本里 `lib/` 与项目是硬链接，重建即同步；`package.json` 与 `cordis.patch.yml` 是拷贝，改了声明需要重新同步。

## 测试

```sh
npm run build
node tests/routes.test.mjs          # 路由与仓库，驱动的是 lib/index.js 真实产物

# 客户端来源模块（浏览器模块，需要 TS 加载器；本机可从 harness 检出里跑）
cd ~/GitHub/deepseek-harness && node --import tsx/esm ~/projects/dhs-moegirl/tests/pack-source.test.mts
```

`tests/routes.test.mjs` 用假的 Cordis context 注册真实构建产物，再拿假 req/res 驱动
真实 handler，装到临时目录里跑，不碰 `~/.dsh/moegirl` 的真实仓库。

## 卸载

```sh
dsh plugin --profile web remove dsh-moegirl
```

## 素材

`src/client/assets/` 下的角色素材为本项目自制（AI 生成），随本仓库以 MIT 授权发布。
`moegirl-sheet.webp` 是压缩后的图集，构建时以编译期 data URI 内联进 `lib/client.js`，因此产物不依赖外部图片请求；它同时也是内置包 `DEFAULT_PACK` 的图集。

## 角色归档

`characters/<id>/` 存放**用生成模型做出来的**角色：原始帧、生成脚本、固定角色句、
拼好的图集与包文档，以及一份记录踩过哪些坑的 README。

这批素材和脚本只存在于临时目录就会丢，连带丢掉「当时到底写了什么 prompt」——
所以一律归档进仓库，跟代码一起版本化。

| 目录 | 角色 | 说明 |
|---|---|---|
| [`characters/blue-blob/`](characters/blue-blob/) | 蓝色团子 | 宝蓝圆身 + 两颗白色大圆眼，六帧，Nano Banana 生成 |
| [`characters/amiya/`](characters/amiya/) | 阿米娅 Q 版 | 《明日方舟》阿米娅的 Q 版，六帧，Nano Banana 生成（本地自用同人） |

通用脚本（生成 / 抠底 / 自检 / 安装）都在 `characters/lib/`，按角色目录参数化；
每个角色目录只需要一个 `character.py` 声明自己的角色句、姿态与画布：

```sh
cd ~/projects/agents3 && uv run python ../lib/check.py  <角色目录>
cd ~/projects/agents3 && uv run python ../lib/cutout.py <角色目录>
bash ../lib/install.sh <角色目录>          # 缺省用当前目录
```

`check.py` 查底边对齐、身体高度一致（尺度锚点）、道具在深色主题下的可见性、
装箱比例（内容占画布多少，以及换算成显示尺寸后人物有多大），以及图集规格。

## 许可

[MIT](LICENSE)
