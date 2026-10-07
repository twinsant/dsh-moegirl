#!/bin/bash
# 把某个角色的图集与包文档装进 dsh 的资源包仓库，并设为当前使用。
#
# 用法：
#   bash characters/lib/install.sh [角色目录]     # 缺省用当前目录
#
# 只做文件复制，不依赖 dsh 进程在跑 —— 装完重启（或刷新页面）即可生效。
set -euo pipefail

CHARACTER_DIR="$(cd "${1:-$PWD}" && pwd)"
STORE="${DSH_HOME:-$HOME/.dsh}/moegirl"

for file in atlas.png pack.json; do
  if [ ! -f "$CHARACTER_DIR/$file" ]; then
    echo "缺 $CHARACTER_DIR/$file —— 先跑 cutout.py" >&2
    exit 1
  fi
done

# 包 id 从产物里读，脚本本身不写死任何角色。
PACK_ID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$CHARACTER_DIR/pack.json")"
DEST="$STORE/packs/$PACK_ID"

mkdir -p "$DEST"
cp "$CHARACTER_DIR/atlas.png" "$CHARACTER_DIR/pack.json" "$DEST/"

# 激活指针单独写：已存在就覆盖，保证装完就是当前使用的那个。
printf '{\n  "id": "%s"\n}\n' "$PACK_ID" > "$STORE/active.json"

echo "装到 $DEST"
ls -l "$DEST"
echo
echo "当前使用：$(cat "$STORE/active.json" | tr -d '\n ')"
echo "想切回内置精灵：设置 → 桌面精灵 → 内置包那一行的「使用内置包」"
echo "（命令行等价操作是删掉 $STORE/active.json；装着的包不会被删）"
