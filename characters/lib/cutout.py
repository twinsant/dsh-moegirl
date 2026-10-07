#!/usr/bin/env python3
"""把生成的帧抠底、对齐、拼成可用于资源包的图集。

用法：

    cd ~/projects/agents3 && uv run python <本目录>/cutout.py [--out DIR]

这一步**不走模型**，全是确定性的，所以可以随便重跑。

为什么需要它（三件事各自解决一个问题）：
  1. 抠底：模型给的是纯洋红底。按「离底色的距离」算连续 alpha，再按
     P = a·F + (1-a)·B 反解前景色，边缘不留洋红描边。
  2. 统一缩放：所有帧套用同一个系数（由最大的内容框定），防止相对变形。
  3. 底边对齐 + 水平居中：状态切换时人物不跳。

阈值不能松：洋红底本身有四角之外约 20 的噪声，斜坡下限设太低会把远处的底噪
算成内容，包围盒虚胖（实测把 553 高的内容报成 973），进而把统一缩放系数算错。
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
from PIL import Image, ImageFilter

import character  # noqa: E402

FRAMES_DIR = CHARACTER_DIR / "frames"

# 洋红底噪声的实测范围：四角在 (253,5,251) 到 (242,25,238) 之间飘。
SOLID_DIST = 110.0   # 超过这个色距才算「实心」
EDGE_DIST = 70.0     # 连续 alpha 的斜坡起点
OPEN_KERNEL = 5      # 开运算核：去掉零散噪点
ALPHA_SOLID = 200    # 量包围盒时算「不透明」的 alpha 门槛


def cutout(path: Path) -> tuple[Image.Image, float]:
    """抠掉洋红底，返回带 alpha 的图和最大色距（用来确认图不是全空）。"""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    height, width, _ = rgb.shape
    # 底色取四角中位数，避免某一角正好被主体压到。
    corners = np.stack([rgb[2, 2], rgb[2, width - 3], rgb[height - 3, 2], rgb[height - 3, width - 3]])
    background = np.median(corners, axis=0)
    distance = np.sqrt(((rgb - background) ** 2).sum(axis=2))

    solid = distance > SOLID_DIST
    # 开运算（先腐蚀再膨胀）去掉零散噪点；不依赖 scipy。
    solid_image = Image.fromarray((solid * 255).astype(np.uint8), "L")
    solid_image = solid_image.filter(ImageFilter.MinFilter(OPEN_KERNEL)).filter(ImageFilter.MaxFilter(OPEN_KERNEL))
    solid = np.asarray(solid_image) > 128
    # 只在实心区外扩一点点的范围内算 alpha，边缘之外一律不算。
    near = np.asarray(
        Image.fromarray((solid * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(OPEN_KERNEL))
    ) > 128

    alpha = np.clip((distance - EDGE_DIST) / (SOLID_DIST - EDGE_DIST), 0.0, 1.0) * near
    safe = np.maximum(alpha, 1e-3)[..., None]
    foreground = (rgb - (1.0 - safe) * background) / safe
    out = np.concatenate([np.clip(foreground, 0, 255), (alpha * 255)[..., None]], axis=2)
    return Image.fromarray(out.astype(np.uint8), "RGBA"), float(distance.max())


def content_box(image: Image.Image) -> tuple[int, int, int, int]:
    """量不透明内容的包围盒。"""
    ys, xs = np.where(np.asarray(image)[..., 3] > ALPHA_SOLID)
    if len(xs) == 0:
        return (0, 0, image.width, image.height)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(CHARACTER_DIR), help="图集与单格图的输出目录")
    parser.add_argument("--atlas-name", default="atlas.png", help="图集文件名")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    names = [name for name, _ in character.POSES]
    missing = [n for n in names if not (FRAMES_DIR / f"{n}.png").exists()]
    if missing:
        raise SystemExit(f"缺帧 {missing}：先用 generate.py 补齐，再来抠底")

    cut: list[tuple[str, Image.Image, tuple[int, int, int, int]]] = []
    for name in names:
        image, max_distance = cutout(FRAMES_DIR / f"{name}.png")
        box = content_box(image)
        cut.append((name, image, box))
        print(f"{name:12s} 内容框 {box[2] - box[0]:4d}×{box[3] - box[1]:4d}  最大色距 {max_distance:.0f}")

    canvas_w, canvas_h = character.CANVAS
    fit_w, fit_h = character.FIT
    # 一个系数套用到所有帧；由最大的内容框定，所以内容大的帧不会越界。
    widest = max(box[2] - box[0] for _, _, box in cut)
    tallest = max(box[3] - box[1] for _, _, box in cut)
    scale = min(canvas_w * fit_w / widest, canvas_h * fit_h / tallest)
    print(f"\n统一缩放系数 {scale:.4f}（依据最大内容 {widest}×{tallest}）")

    cells: list[Image.Image] = []
    for name, image, (x0, y0, x1, y1) in cut:
        content = image.crop((x0, y0, x1, y1))
        target = (max(1, round(content.width * scale)), max(1, round(content.height * scale)))
        content = content.resize(target, Image.LANCZOS)
        cell = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        cell.paste(content, ((canvas_w - target[0]) // 2, round(canvas_h * character.BASELINE) - target[1]), content)
        cells.append(cell)
        cell.save(out_dir / f"cell-{name}.png")
        print(f"{name:12s} → 画布内 {target[0]}×{target[1]}")

    atlas = Image.new("RGBA", (canvas_w, canvas_h * len(cells)), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        atlas.paste(cell, (0, index * canvas_h))
    atlas_path = out_dir / args.atlas_name
    atlas.save(atlas_path, optimize=True)
    print(f"\n图集 {atlas.width}×{atlas.height}  {atlas_path.stat().st_size / 1024:.0f}KB  → {atlas_path}")
    print(f"行序 {character.ATLAS_ORDER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
