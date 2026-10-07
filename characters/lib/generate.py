#!/usr/bin/env python3
"""生成本角色的状态帧。

用法（必须用 agents3 的 venv，google-genai 装在那里）：

    cd ~/projects/agents3 && HTTPX_PROXY=socks5h://127.0.0.1:1234 \\
      uv run python <本目录>/generate.py [--only 01-idle,04-attention] [--dry-run]

为什么代理要显式给：`agents3/.env` 里存的是 `socks5://127.0.0.1:1234`，对 Google
一律返回 000（本地 DNS 解析失败），必须改成 `socks5h://`（远端 DNS）。本脚本也会
把读到的前缀强制改写，双保险，但环境变量优先。

生成顺序有意义：先出 `character.REFERENCE` 那一帧当角色设定图，其余各帧都以它
当参考图。单独重画某一帧时，参考图仍然是设定图 —— 这样重画不会越跑越偏。
"""

from __future__ import annotations

import argparse
import os
import sys
import time
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

FRAMES_DIR = CHARACTER_DIR / "frames"

import character  # noqa: E402

sys.path.insert(0, os.path.expanduser("~/projects/agents3"))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.expanduser("~/projects/agents3/.env"))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
import httpx  # noqa: E402  # noqa: E402


def build_client() -> genai.Client:
    """建一个走代理的客户端。"""
    proxy = os.getenv("HTTPX_PROXY", "").replace("socks5://", "socks5h://")
    if proxy:
        print(f"    代理 {proxy.split('//')[0]}://（已把 socks5 改写成 socks5h）")
    return genai.Client(http_options={"httpx_client": httpx.Client(proxy=proxy, timeout=240)})


def reference_part() -> types.Part:
    """读角色设定图，作为每一帧的参考图。"""
    path = FRAMES_DIR / f"{character.REFERENCE}.png"
    if not path.exists():
        raise SystemExit(f"缺角色设定图 {path}：先单独生成 {character.REFERENCE}，再生成其余帧")
    return types.Part.from_bytes(data=path.read_bytes(), mime_type="image/png")


def prompt_for(pose: str) -> str:
    """拼一帧的完整 prompt。角色句与风格句逐字来自 character.py。"""
    return (
        f"{character.ROLE}\n\n{character.STYLE}\n\nPOSE: {pose}\n\n"
        "The creature must look exactly like the reference image: same blue, same eye "
        "shape, same proportions, same scale, same position in the frame."
    )


def generate_one(client: genai.Client, name: str, pose: str, part: types.Part | None) -> bool:
    """生成一帧，落到 frames/<name>.png。"""
    out = FRAMES_DIR / f"{name}.png"
    contents: list = [prompt_for(pose)]
    if part is not None:
        contents.append(part)
    start = time.time()
    try:
        response = client.models.generate_content(
            model=character.MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio=character.ASPECT,
                    image_size=character.RESOLUTION,
                ),
            ),
        )
    except Exception as error:  # 429 = 月度额度到顶，其余多为临时故障
        print(f"❌ {name}  {type(error).__name__}: {str(error)[:200]}")
        return False

    for part_ in response.candidates[0].content.parts or []:
        if part_.text:
            print(f"    [{name}] 模型附言: {part_.text.strip()[:160]}")
        elif getattr(part_, "inline_data", None):
            out.write_bytes(part_.inline_data.data)
            if out.stat().st_size > 50_000:
                print(f"✅ {name}  {out.stat().st_size / 1024:.0f}KB  {time.time() - start:.0f}s")
                return True
    print(f"❌ {name} 没有有效图片（可能被安全过滤拦了）")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="只生成这些帧，逗号分隔，例如 01-idle,04-attention")
    parser.add_argument("--dry-run", help="只打印 prompt，不调接口", action="store_true")
    args = parser.parse_args()

    wanted = set(args.only.split(",")) if args.only else None
    todo = [(n, p) for n, p in character.POSES if wanted is None or n in wanted]
    if not todo:
        print(f"--only 没匹配到任何帧；可选 {[n for n, _ in character.POSES]}")
        return 2

    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        for name, pose in todo:
            print(f"\n=== {name} ===\n{prompt_for(pose)}")
        return 0

    client = build_client()
    # 只生成参考帧本身时不能拿它当参考图（还没有那个文件）。
    needs_ref = any(name != character.REFERENCE for name, _ in todo)
    part = reference_part() if needs_ref else None

    failed = [name for name, pose in todo if not generate_one(client, name, pose, part)]
    print(f"\n{len(todo) - len(failed)}/{len(todo)} 成功" + (f"，失败 {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
