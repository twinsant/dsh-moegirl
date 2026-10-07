# 蓝色团子 (blue-blob)

一个桌面精灵角色。宝蓝圆身、两颗白色大圆眼，六个状态帧，用 Google 的 Nano Banana
（`gemini-3-pro-image-preview`）生成，再确定性抠底对齐成图集。

参考图是用户给的一张「宝蓝底 + 两颗白圆」——这就是角色的身份特征，所以眼睛必须是
又大又圆的纯白圆眼。

## 重新生成

```sh
# 通用脚本都在 characters/lib/，角色特有的参数在本目录的 character.py 里。
# 第一个位置参数是角色目录（缺省用当前目录）—— 下面用「cd 进角色目录再跑」的写法。
cd ~/projects/dhs-moegirl/characters/blue-blob

# 1) 生成帧（必须用 agents3 的 venv，google-genai 装在那里）
cd ~/projects/agents3 && HTTPX_PROXY=socks5h://127.0.0.1:1234 \
  uv run python ~/projects/dhs-moegirl/characters/lib/generate.py ~/projects/dhs-moegirl/characters/blue-blob

# 只想重画某一帧（仍然拿设定图当参考图，不会越跑越偏）
cd ~/projects/agents3 && HTTPX_PROXY=socks5h://127.0.0.1:1234 \
  uv run python .../lib/generate.py <角色目录> --only 03-working

# 只打印 prompt，不调接口
uv run python .../lib/generate.py <角色目录> --dry-run

# 2) 抠底、对齐、拼图集（不走模型，可以随便重跑）
cd ~/projects/agents3 && uv run python .../lib/cutout.py <角色目录>

# 3) 自检（底边、本体尺寸、道具对比度、图集规格）
cd ~/projects/agents3 && uv run python .../lib/check.py <角色目录>

# 4) 装进 dsh 的资源包仓库
bash .../lib/install.sh <角色目录>
```

**代理必须写 `socks5h://`**：`agents3/.env` 里存的是 `socks5://127.0.0.1:1234`，对
Google 一律返回 `000`（本地 DNS 解析失败），`socks5h` 才是远端 DNS。判据是
`curl -x socks5h://127.0.0.1:1234 https://generativelanguage.googleapis.com/` 返回
**404 = 通**、`000` = 不通；用 `socks5://` 测同一个地址会得到假阴性。

## 流程

```
用户参考图 ──┐
             ├─→ 01-idle（角色设定图）──┬─→ 02..06 各帧（都以 01-idle 当参考图）
角色句/风格句 ┘                        ┘
                                          ↓
                             抠底 → 统一缩放 → 底边对齐 → 竖排图集
                                          ↓
                                  pack.json + atlas.png → 资源包仓库
```

一致性靠三板斧：**先出设定图**、**每帧都以设定图当参考图**、**角色句与风格句逐字复用**
（它们只在 `scripts/character.py` 里写一次，别处不要复制）。

## 踩过的坑

### 1. 抠底阈值太松 → 包围盒虚胖 → 缩放系数算错

洋红底不是绝对纯色，四角在 `(253,5,251)` 到 `(242,25,238)` 之间飘，噪声约 20。最初把
alpha 斜坡下限设成色距 40、包围盒又按 `alpha > 12` 取，远处的底噪全被算成内容，同一格
内容框在两次测量里报出 569 和 973 两个值，一度误判成「模型把人画小了」。

现在：实心用硬阈值 110，alpha 斜坡只在 `70→110` 的边缘过渡带里算，并且只在实心区外扩
一点点的范围内生效，外加一次开运算去零散噪点。包围盒按 `alpha > 200` 取。

### 2. 画布比例照抄内置精灵 → 人物只占半格高

内置精灵是 384×667（9:16），但这是只**圆团子**，内容接近方形。照抄 9:16 会让画布高度
远大于内容，宽度成为约束条件，人物只占半格高度、上面一大片空白。

现在的画布 384×512（3:4）：高度要容得下飘得最高的道具（问号），同时保证**宽度仍是
约束条件** —— 否则道具会把所有帧的人物一起压小。

顺带一个好处：512/384 = 4/3，精灵按 132px 宽显示时高度是 `132×512/384 = 176` 的整数，
CSS 的 `background-size` 没有取整误差。

> 改道具高度后一定要重看：道具变高会顶高内容框，一旦高度顶掉宽度成为约束，**所有帧**
> 的人物尺寸都会被压小。

### 3. 道具用深蓝画 → 深色主题下直接消失

叹号（attention）和问号（approval）最初是和身体同色系的深蓝，浅色主题下看得见，
**深色主题下几乎看不见**。而这两个符号正是「有会话等你操作」和「等你批准」的主要信号，
丢了就是功能损失。

现在道具是亮黄 `#FFC53D` 加厚深蓝描边，两种主题都清楚。`../lib/check.py` 会量道具区
的亮度并在偏暗时报警 —— 这是这套流程里唯一「浅底看着没问题、换深底才暴露」的问题，
必须靠脚本兜住，不能靠眼睛。

另外 `working` 原本画成眯眼攥拳，读起来是**发怒**而不是忙碌，已改成圆睁大眼加黄色速度线。

## 文件

| 路径 | 说明 |
|---|---|
| `character.py` | **唯一事实来源**：角色句、风格句、道具规则、六帧姿态、画布规格 |
| `../lib/generate.py` | 调 Nano Banana 生成帧，支持 `--only` / `--dry-run` |
| `../lib/cutout.py` | 抠底、统一缩放、底边对齐、拼图集（不走模型） |
| `../lib/check.py` | 自检：底边、眼睛跨度、道具对比度、图集规格 |
| `../lib/install.sh` | 装进 `~/.dsh/moegirl/packs/<包 id>/` 并设为当前使用 |
| `frames/0N-*.png` | 生成的原帧（洋红底，未处理），改动前的原始素材 |
| `atlas.png` | 拼好的图集，六格 384×512 竖排 |
| `pack.json` | 资源包文档（画布、帧名、帧序列、动作、气泡） |
| `preview.png` | 浅色/深色主题下 1:1 显示尺寸对照，用来确认小尺寸可读性 |

## 状态与动作

| 状态 | 帧 | 动作 | 表现 |
|---|---|---|---|
| idle | 0 | `breathe` + `blink` 序列 | 呼吸（带挤压），每 4.8 秒眨一次眼 |
| working | 2 | `hop` | 跳，落地带压扁 |
| attention | 3 | `breathe` | 挥单手 + 黄色叹号 |
| approval | 5 | `await-decision` | 抬头 + 黄色问号 |
| done | 4 | `rejoice` | 双手上举 + 星星 |

点击精灵触发 `reaction`（弹性缩放），并浮出 💙。

帧序列与动作都写在 `pack.json` 里，要调时间轴不必重新生图 —— 直接在
**设置 → 桌面精灵** 的编辑器里改，或者手改 `pack.json` 后跑 `install.sh`。
