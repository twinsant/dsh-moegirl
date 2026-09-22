# dsh-moegirl

DeepSeek Harness（dsh）的桌面精灵插件：在 Web UI 右下角悬浮一只双马尾萌娘，实时反映 agent 的运行状态。

<img width="1046" height="311" alt="image" src="https://github.com/user-attachments/assets/593ae249-18b2-4ee7-ae2d-6b454e33b31d" />


## 状态

精灵从全局会话列表（`useSessions` 标准钩子）推导四种状态，优先级从高到低：

| 状态 | 触发条件 | 表现 |
|---|---|---|
| 求关注 attention | 有会话等待审批 / 计划评审 / 回答问题 | 挥手 + 红色感叹号气泡 |
| 工作中 working | 有会话正在运行 | 快速跳动 + 旋转星星 |
| 完成啦 done | 有非选中会话刚刚跑完 | 开心眼 + 小花 + 跳跃 |
| 摸鱼中 idle | 无任务 | 呼吸 + 眨眼 + Zzz |

点击精灵可手动展开/收起气泡；attention 与 done 状态气泡会自动弹出。

## 原理

这是一个 dsh Web GUI 浏览器侧插件（Cordis 插件 + client 动态行）：

- `src/index.ts` 是 host 侧入口（空 apply，无 Node 侧行为）；
- `src/client/index.ts` 通过 `ctx.slots.inject('shell.overlay', …)` 把精灵组件注册进 ui-layout 声明的整页浮层 slot（list 型，增量挂载，不替换任何现有 UI）；
- 构建产物 `lib/client.js` 遵循 dsh 客户端 bundle 契约：CJS 闭包 + `window.__ModuleLoader__.load({ id, factory })`，React / Cordis / ui-slots 等 baseline 模块由宿主模块表注入；
- 包声明 `dsh.bundle.patch`，作为 bundle 安装时自带 cordis.patch.yml 插入 Loader 行。

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

## 卸载

```sh
dsh plugin --profile web remove dsh-moegirl
```

## 素材

`src/client/assets/` 下的角色素材为本项目自制（AI 生成），随本仓库以 MIT 授权发布。
`moegirl-sheet.webp` 是实际使用的 5 帧精灵图，压缩自 `moegirl-sheet.png`；构建时以
编译期 data URI 内联进 `lib/client.js`，因此产物不依赖外部图片请求。

## 许可

[MIT](LICENSE)
