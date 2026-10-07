#!/usr/bin/env python3
"""检查图集有没有踩到已知的坑。改完帧或改完抠底参数都该跑一遍。

用法：

    cd ~/projects/agents3 && uv run python <本目录>/check.py [--atlas PATH]

四项检查，每项对应一个真实踩过的坑：

  1. **底边一致** —— 底边不齐，状态切换时人物会上下跳。
  2. **身体高度一致** —— 尺度锚点。内容框不行（道具会把它撑大），身体宽度也不行
     （举手会把它撑宽），身体高度对站姿角色是稳的。
  3. **道具对比度** —— 叹号/问号如果是深蓝的（与身体同色系），深色主题下等于没有。
  4. **图集规格** —— 行数与每格尺寸是否与 character.py 声明一致。

第 3 项是这套流程里唯一「浅底看着没问题、换深底才暴露」的问题，必须靠脚本兜住：
当初做完六帧看着都对，换到深底才发现叹号不见了。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

def resolve_character_dir() -> Path:
    """把角色目录从 argv 里摘出来；缺省用当前目录。

    通用脚本放在 characters/lib/，角色特有的参数全在 `<角色目录>/character.py`。
    必须在 import character 之前解析 —— 角色目录要先进 sys.path。
    """
    argv = sys.argv[1:]
    if argv and not argv[0].startswith("-"):
        directory = Path(argv.pop(0)).resolve()
        sys.argv = [sys.argv[0], *argv]
    else:
        directory = Path.cwd()
    if not (directory / "character.py").exists():
        raise SystemExit(
            f"{directory} 里没有 character.py —— 用位置参数指到角色目录，或 cd 进去再跑"
        )
    return directory


CHARACTER_DIR = resolve_character_dir()
sys.path.insert(0, str(CHARACTER_DIR))

import numpy as np
from PIL import Image

import character  # noqa: E402

ALPHA_SOLID = 200
# 亮度低于这个值的道具在深色主题上会糊掉（深色界面大致 #1A1A1C，亮度约 26）。
PROP_MIN_LUMA = 90.0
# 各帧「身体高度」相差超过这个比例，说明某一帧的人物被画得跟别帧不一样大。
# 用身体高度而不是眼睛跨度，是因为它对角色的画法没有假设：眼睛跨度只对圆眼角色
# 成立（amiya 是蓝虹膜加白色高光，近白像素还会混进头发高光，量出来的不是眼睛）。
BODY_HEIGHT_TOLERANCE = 0.10
# 内容至少要占画布某一个方向的这个比例，否则画布远大于内容、人物会明显偏小。
# 这条是唯一能发现「整体缩放偏小」的检查 —— 统一缩放对六帧等比例，各帧之间比对
# 永远看不出问题（blue-blob 当初就是这么被 9:16 画布坑的）。
MIN_FILL = 0.60
# 精灵在界面上的显示宽度，与壳里的 DISPLAY_W 一致，用来换算人物实际有多少像素。
SPRITE_DISPLAY_WIDTH = 132
# 一帧里白色像素少于此值就认为没有圆眼（闭眼、或弯月笑眼）。
EYE_MIN_PIXELS = 300
# 眼白只在身体的这个比例范围内找（头部）。限制范围是必需的：穿白衣服的角色
# （amiya 的白衬衫）近白像素会铺满前胸，不限范围的话「眼白跨度」量到的是衬衫宽度，
# 尺度锚点就废了。
HEAD_REGION = 0.45
# 小于这个像素数的「非身体」区域算噪点，不算道具。
PROP_MIN_PIXELS = 300


def luminance(rgb: np.ndarray) -> np.ndarray:
    """感知亮度，够用就行。"""
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def reconstruct(seed: np.ndarray, mask: np.ndarray, max_iterations: int = 4000) -> np.ndarray:
    """形态学重建：反复膨胀种子并与 mask 求交，直到稳定。

    结果就是从种子出发、在 mask 内连通的那一块。比 Pillow 的 floodfill 可靠
    （实测那个函数在本用途下填了 0 个像素），也不依赖 scipy。迭代次数等于测地
    距离，一格 500px 高最多几百次，每次几个 numpy 切片，毫秒级。
    """
    current = seed & mask
    for _ in range(max_iterations):
        grown = current.copy()
        grown[1:, :] |= current[:-1, :]
        grown[:-1, :] |= current[1:, :]
        grown[:, 1:] |= current[:, :-1]
        grown[:, :-1] |= current[:, 1:]
        grown &= mask
        if np.array_equal(grown, current):
            return current
        current = grown
    return current


def body_mask(opaque: np.ndarray) -> np.ndarray:
    """取出与躯干连通的那一块。

    不能用行密度分身体和道具：圆头顶部每行像素本来就少，会被误判成道具；
    而一个又大又粗的道具（approval 的问号）又会反过来把行密度撑高。
    真正的判据是连通性 —— 道具是浮在上方、和身体不相连的。

    身体顶部用「够宽的行」找：躯干是团块，头几行一定宽；道具再粗也远窄于躯干。
    找到之后再从躯干内部播种做连通域重建。
    """
    ys, _ = np.where(opaque)
    widths = opaque.sum(axis=1)
    peak = widths[int(ys.min()):int(ys.max()) + 1].max()
    wide_rows = np.where(widths >= peak * 0.5)[0]
    body_top = int(wide_rows.min()) if len(wide_rows) else int(ys.min())

    # 种子取身体上半部的一块，播种在横向中位数处（那里一定是实心躯干）。
    seed_y = body_top + max(1, (int(ys.max()) - body_top) // 4)
    row = np.where(opaque[seed_y])[0]
    if len(row) == 0:
        return opaque
    seed_x = int(np.median(row))

    seed = np.zeros_like(opaque)
    seed[seed_y, seed_x] = True
    body = reconstruct(seed, opaque)
    # 兜底：万一重建只吃掉一小块（种子落在孤岛里），就当没有身体信息。
    return body if body.sum() > opaque.sum() * 0.2 else opaque


def probe(cell: np.ndarray, label: str) -> dict:
    """量一格：内容框、身体范围、眼白跨度、道具亮度。"""
    alpha = cell[..., 3]
    opaque = alpha > ALPHA_SOLID
    ys, xs = np.where(opaque)
    if len(xs) == 0:
        raise SystemExit(f"{label}: 整格都是透明的，抠底把它吃光了")
    rgb = cell[..., :3].astype(np.float32)

    body = body_mask(opaque)
    body_ys, body_xs = np.where(body)
    body_top, body_bottom = int(body_ys.min()), int(body_ys.max())
    body_widths = body.sum(axis=1)
    body_width = int(body_widths[body_top:body_bottom + 1].max())

    # 眼白：只在头部范围内找近白像素，避免把白衣服算成眼睛。
    # 关键：还要**在身体这一连通域内**。飘在头侧的道具（星星）也是近白的，
    # 又是独立的一块，不限定在身体里就会被当成眼睛，尺度锚点直接量错。
    white = body & (rgb[..., 0] > 215) & (rgb[..., 1] > 215) & (rgb[..., 2] > 215)
    head_bottom = body_top + int((body_bottom - body_top) * HEAD_REGION)
    white[:body_top, :] = False
    white[head_bottom:, :] = False
    eye_ys, eye_xs = np.where(white)
    if len(eye_xs) >= EYE_MIN_PIXELS:
        eyes = {"span": int(eye_xs.max() - eye_xs.min()), "top": int(eye_ys.min()), "bottom": int(eye_ys.max())}
    else:
        eyes = None

    # 道具：与身体不连通的不透明像素（飘在头上的符号）。
    prop = opaque & ~body
    prop_ys, _ = np.where(prop)
    if len(prop_ys) >= PROP_MIN_PIXELS:
        prop_luma = luminance(rgb[prop])
        props = {
            "count": int(len(prop_ys)),
            "top": int(prop_ys.min()),
            "mean_luma": float(prop_luma.mean()),
            "bright_luma": float(np.percentile(prop_luma, 95)),
        }
    else:
        props = None

    return {
        "label": label,
        "bottom": int(ys.max()),
        "content": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
        "body": (body_top, body_bottom, body_width),
        "eyes": eyes,
        "prop": props,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--atlas", default=str(CHARACTER_DIR / "atlas.png"))
    args = parser.parse_args()

    atlas_path = Path(args.atlas)
    if not atlas_path.exists():
        raise SystemExit(f"找不到 {atlas_path}：先跑 cutout.py")

    atlas = Image.open(atlas_path).convert("RGBA")
    cell_w, cell_h = character.CANVAS
    order = character.ATLAS_ORDER
    warnings: list[str] = []

    if atlas.width != cell_w or atlas.height != cell_h * len(order):
        warnings.append(
            f"图集 {atlas.width}×{atlas.height} 与声明的 {cell_w}×{cell_h}×{len(order)} 不符"
        )

    print(f"图集 {atlas_path.name}  {atlas.width}×{atlas.height}  每格 {cell_w}×{cell_h}  行序 {order}\n")
    print(f"{'行':10s} {'底边':>5s} {'身体行':>10s} {'最宽行':>7s} {'眼白跨度':>9s} {'道具':>20s}")

    results = []
    rows = min(atlas.height // cell_h, len(order))
    for index in range(rows):
        state = order[index]
        cell = np.asarray(atlas.crop((0, index * cell_h, cell_w, (index + 1) * cell_h)))
        info = probe(cell, state)
        results.append(info)
        body_top, body_bottom, body_width = info["body"]
        eyes = info["eyes"]
        prop = info["prop"]
        print(
            f"{state:10s} {info['bottom']:5d} "
            f"{body_top:4d}-{body_bottom:<4d} {body_width:7d} "
            f"{(str(eyes['span']) if eyes else '(无圆眼)'):>9s} "
            f"{('无' if prop is None else str(prop['count']) + 'px 亮' + format(prop['bright_luma'], '.0f')):>20s}"
        )

    print()

    bottoms = {r["bottom"] for r in results}
    if len(bottoms) == 1:
        print(f"✅ 底边一致（{bottoms.pop()}）")
    else:
        warnings.append(f"底边不一致：{sorted(bottoms)}，状态切换时人物会上下跳")
        print(f"❌ 底边不一致 {sorted(bottoms)}")

    # 尺度一致性：各帧的身体高度。统一缩放对六帧等比例，所以某一帧被画得比别帧大
    # 会在这里暴露；跳跃那一帧（脚离地）会略短，容差给了 10%。
    heights = [(r["label"], r["body"][1] - r["body"][0]) for r in results]
    values = [h for _, h in heights]
    spread = max(values) / min(values) - 1
    text = "、".join(f"{label} {h}" for label, h in heights)
    if spread <= BODY_HEIGHT_TOLERANCE:
        print(f"✅ 身体高度一致（{text}）")
    else:
        warnings.append(
            f"身体高度相差 {spread * 100:.0f}%（{text}）—— 某一帧的人物被画得跟别帧不一样大，"
            "重画那一帧（generate.py --only <帧名>）"
        )
        print(f"❌ 身体高度相差 {spread * 100:.0f}%（{text}）")

    # 装箱报告：画布相对内容有多大。这是唯一能发现「整体缩放偏小」的地方。
    canvas_w, canvas_h = character.CANVAS
    widest = max(r["content"][2] - r["content"][0] for r in results)
    tallest = max(r["content"][3] - r["content"][1] for r in results)
    fill_w, fill_h = widest / canvas_w, tallest / canvas_h
    shown_h = round(widest * SPRITE_DISPLAY_WIDTH / canvas_w)
    shown_v = round(tallest * SPRITE_DISPLAY_WIDTH / canvas_w)
    print(f"\n装箱：内容最多 {widest}×{tallest}，画布 {canvas_w}×{canvas_h} 下占宽 {fill_w:.0%}、占高 {fill_h:.0%}")
    print(f"      显示尺寸 {SPRITE_DISPLAY_WIDTH}×{round(canvas_h * SPRITE_DISPLAY_WIDTH / canvas_w)}，内容约 {shown_h}×{shown_v}px")
    if max(fill_w, fill_h) < MIN_FILL:
        warnings.append(
            f"内容只占画布 {max(fill_w, fill_h):.0%}（低于 {MIN_FILL:.0%}）—— 画布远大于内容，"
            "人物会明显偏小；按内容实际形状重定 CANVAS 高度"
        )
        print(f"❌ 内容占画布比例过低")

    # 眼白跨度只对圆眼角色有意义（且会被头发高光、星星干扰），仅作参考打印。
    circled = [(r["label"], r["eyes"]["span"]) for r in results if r["eyes"] is not None and r["eyes"]["span"] > 40]
    if len(circled) >= 2:
        print(f"ℹ️ 眼白跨度（仅参考）：{'、'.join(f'{label} {span}' for label, span in circled)}")

    for result in results:
        prop = result["prop"]
        # 用 95 分位而不是平均值：道具自带的深色描边会把均值拉低，
        # 而「深色主题下看不看得见」取决于它最亮的那些像素。
        if prop is not None and prop["bright_luma"] < PROP_MIN_LUMA:
            warnings.append(
                f"{result['label']} 的道具偏暗（最亮 5% 亮度 {prop['bright_luma']:.0f} < {PROP_MIN_LUMA:.0f}），"
                "深色主题下会看不见 —— 按 character.PROP_RULE 重画该帧"
            )
        elif prop is not None:
            print(f"✅ {result['label']} 道具最亮 {prop['bright_luma']:.0f}，深色主题下可见")

    if warnings:
        print(f"\n{len(warnings)} 处要处理：")
        for warning in warnings:
            print(f"  · {warning}")
        return 1
    print("\n全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
