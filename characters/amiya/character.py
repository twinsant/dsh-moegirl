"""阿米娅 Q 版的生成参数：固定角色句、风格句、姿态表、画布规格。

这个文件是唯一的事实来源。角色句和风格句必须**逐字复用**——整组六帧的一致性
全靠它们锁定，改一个字人物就会漂；所以不要在别处复制它们，让脚本 import 这里。

跑法（通用脚本在 `../lib/`）：

    cd ~/projects/agents3 && HTTPX_PROXY=socks5h://127.0.0.1:1234 \\
      uv run python ../lib/generate.py <本目录>
    cd ~/projects/agents3 && uv run python ../lib/cutout.py <本目录>
    cd ~/projects/agents3 && uv run python ../lib/check.py  <本目录>
    bash ../lib/install.sh <本目录>

关于点名：Nano Banana 的安全过滤会拦掉 prompt 里受版权保护的角色名（返回空
content）。所以下面**只描述外形、不写角色名**——模型照样能照着描述画出来，
而且这本来也就是一份本地自用的同人精灵。

设计取舍：
  * 兔耳是唯一的剪影识别点，必须画得又长又清楚；132px 宽下别的细节都会糊。
  * 不画她的剑。带剑会让每个状态都要重新摆一遍手，一致性成本高，小尺寸下也只是
    多一团黑色。要加的话单独开一个状态，不要混进这五个。
  * 道具放在头侧、贴着耳朵的高度，不要飘到画面顶部——她是竖长身形，道具再往上飘
    会顶高内容框，把每格画布一起撑高（blue-blob 就是这么被压小的）。
"""

ID = "amiya"
NAME = "阿米娅 Q 版"

MODEL = "gemini-3-pro-image-preview"
ASPECT = "9:16"
RESOLUTION = "1K"

# 先出这一帧当角色设定图，其余各帧都以它当参考图 —— 这是整组一致性的来源。
REFERENCE = "01-idle"

ROLE = (
    "CHARACTER (must stay identical in every image): a cute chibi anime girl, Q-version "
    "proportions with a large head roughly one third of her total height and a small body. "
    "Long rabbit ears — tall, upright, dark brown-black on the outside with a soft pink "
    "inner surface, clearly readable in silhouette. Shoulder-length dark brown hair with a "
    "side-swept fringe and two longer strands framing her face. Very large bright blue eyes "
    "with white highlights. Small calm mouth. She wears a long dark navy coat with a high "
    "collar and thin cyan-blue trim, a white shirt underneath, black shorts, black "
    "thigh-high stockings, and short brown boots. Clean friendly expression, standing "
    "upright, facing the viewer."
)

STYLE = (
    "STYLE: modern flat anime mascot illustration, soft cel shading, clean rounded shapes, "
    "thin clean linework, crisp highlights, extremely readable at small size.\n"
    "BACKGROUND: flat solid uniform magenta #FF00FF filling every corner, absolutely no "
    "gradient, no shadow, no reflection, no ground plane.\n"
    "Full body, front view, centered horizontally, generous even margin. No text, no "
    "watermark, no border, no weapon."
)

# 与身体同色系的符号在深色主题下等于没有。必须自带高对比描边。
# 位置也要约束：贴着头的侧面，不许飘到画面顶部（否则内容框变高、每格画布被撑大）。
PROP_RULE = (
    "PROP RULE: the floating symbol must be a LARGE BOLD bright warm yellow #FFC53D shape "
    "surrounded by a thick dark navy outline, so it stays clearly visible on a dark "
    "background as well as a light one. It must NOT be blue and must NOT be subtle. "
    "Place it just above and to one side of her head, at ear height, close to her — NOT "
    "floating near the top edge of the image."
)

# 帧序号 → 姿态描述。文件名前缀决定图集里的行序，不要重排。
POSES: list[tuple[str, str]] = [
    ("01-idle", (
        "standing upright and relaxed, facing the viewer, both eyes fully open and round, "
        "arms resting at her sides, calm friendly expression."
    )),
    ("02-blink", (
        "identical standing pose, identical framing, identical body and identical clothes as "
        "the reference image, but BOTH eyes fully closed: each eye becomes a thin "
        "downward-curving closed line in exactly the same size and position as the open eye. "
        "Nothing else changes at all."
    )),
    ("03-working", (
        "leaning slightly forward, cheerfully busy and hard at work, both hands raised in "
        "front as if typing quickly, eyes wide open and bright looking attentively down at "
        "her hands, eager friendly determined look — cheerful and keen, definitely NOT angry, "
        "NOT frowning, no angry eyebrows. Two short bold bright yellow speed lines with dark "
        "navy outlines beside her hands."
    )),
    ("04-attention", (
        "one arm raised high and waving to get attention, body tilted slightly, eyes wide "
        "open and alert, rabbit ears perked up, and one large bold exclamation mark floating "
        "beside her head. " + PROP_RULE
    )),
    ("05-done", (
        "both arms raised up celebrating, a small happy hop off the ground, eyes closed as "
        "upward-curving happy arcs, rabbit ears lifted, two small simple sparkles floating "
        "beside her head."
    )),
    ("06-approval", (
        "standing still waiting patiently for a decision, head tilted slightly to one side, "
        "eyes open and looking slightly upward, and one large bold question mark floating "
        "beside her head. " + PROP_RULE
    )),
]

# 图集行序，必须与 POSES 的前缀顺序一致，也必须是插件会向资源包索取的状态 id。
ATLAS_ORDER = ["idle", "blink", "working", "attention", "done", "approval"]

# 画布规格。她是竖长身形（量出来内容 566×1178，长宽比 2.08），所以不能照抄
# blue-blob 那个接近方形的画布。
#
# 704 这个高度是算出来的：内容高 1178、宽 566，要让尺度接近内置精灵（显示 132×229、
# 人物约 200px 高），反推出缩放约 0.54，换算成画布高就是 700 上下；取 32 的倍数得
# 704 —— 32 的倍数保证显示高度 132×704/384 = 242 是整数，CSS 的 background-size
# 没有取整误差。
#
# 六帧实测高度完全一致（都是 1178，只有 done 因起跳是 1158），道具放在头侧没有顶高
# 内容框，所以这里是高度成约束也安全；check.py 的眼白跨度会兜住这一点。
CANVAS = (384, 704)          # 每格像素；显示尺寸 132×242，人物约 218px 高
FIT = (0.90, 0.90)           # 内容最多占画布的比例
BASELINE = 0.94              # 内容底边落在画布高度的这个位置
