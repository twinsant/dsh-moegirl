#!/usr/bin/env python3
"""按 1:1 显示尺寸出对照图，用来确认小尺寸下还看得清。

用法：

    cd ~/projects/agents3 && uv run python <本目录>/preview.py [角色目录]

做成两排：浅色主题底、深色主题底。精灵在页面上就是 132px 宽，所以这里也按
132px 画 —— 放大看会骗人，缩到这个尺寸还能不能认出角色才是它要回答的问题。

参数全部读 `<角色目录>/pack.json`，脚本本身不写死任何角色，也不 import
character.py（那是生成参数，与产物规格是两回事）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

DISPLAY_W = 132      # 与 MoegirlSprite.tsx 里的 DISPLAY_W 一致
GAP = 10
MARGIN = 12
# 浅色与深色主题各取一个接近实际界面的底色。
BACKGROUNDS = [(246, 246, 248), (26, 27, 32)]


def resolve_character_dir() -> Path:
    """把角色目录从 argv 里摘出来；缺省用当前目录。"""
    argv = sys.argv[1:]
    directory = Path(argv[0]).resolve() if argv else Path.cwd()
    if not (directory / "pack.json").exists():
        raise SystemExit(f"{directory} 里没有 pack.json —— 用位置参数指到角色目录，或 cd 进去再跑")
    return directory


def main() -> int:
    directory = resolve_character_dir()
    pack = json.loads((directory / "pack.json").read_text())
    frame_w, frame_h = pack["frame"]["width"], pack["frame"]["height"]
    count = pack["atlas"]["count"]
    order = [name for name, row in sorted(pack["frames"].items(), key=lambda item: item[1])]
    if len(order) != count:
        raise SystemExit(f"fram 表有 {len(order)} 项，atlas.count 是 {count}，对不上")

    display_h = round(DISPLAY_W * frame_h / frame_w)
    atlas = Image.open(directory / pack["atlas"]["src"]).convert("RGBA")

    width = MARGIN * 2 + count * DISPLAY_W + (count - 1) * GAP
    height = MARGIN * 2 + len(BACKGROUNDS) * display_h + (len(BACKGROUNDS) - 1) * GAP
    sheet = Image.new("RGB", (width, height), BACKGROUNDS[0])

    for band, background in enumerate(BACKGROUNDS):
        y = MARGIN + band * (display_h + GAP)
        band_box = Image.new("RGB", (width, display_h), background)
        sheet.paste(band_box, (0, y))
        for index in range(count):
            cell = atlas.crop((0, index * frame_h, frame_w, (index + 1) * frame_h))
            cell = cell.resize((DISPLAY_W, display_h), Image.LANCZOS)
            sheet.paste(cell, (MARGIN + index * (DISPLAY_W + GAP), y), cell)

    out = directory / "preview.png"
    sheet.save(out, optimize=True)
    print(f"对照图 {sheet.width}×{sheet.height}  {out.stat().st_size / 1024:.0f}KB  → {out}")
    print(f"每格 {DISPLAY_W}×{display_h}（1:1 显示尺寸）  行序 {order}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
