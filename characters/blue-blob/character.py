"""蓝色团子的生成参数：固定角色句、风格句、姿态表、画布规格。

这个文件是唯一的事实来源。角色句和风格句必须**逐字复用**——整组六帧的一致性
全靠它们锁定，改一个字人物就会漂；所以不要在别处复制它们，让脚本 import 这里。

通用脚本在 `../lib/`，本文件放在角色目录根部；跑法：

    cd ~/projects/agents3 && uv run python ../lib/check.py .

改动历史（都影响成品，别回退）：
  * 道具（叹号/问号）原本是深蓝的，在深色主题下几乎看不见，重画成亮黄加厚描边。
  * working 原本是眯眼攥拳，读起来是发怒而不是忙碌，改成圆睁大眼加速度线。
"""

ID = "blue-blob"
NAME = "蓝色团子"

MODEL = "gemini-3-pro-image-preview"
ASPECT = "9:16"
RESOLUTION = "1K"

# 先出这一帧当角色设定图，其余各帧都以它当参考图 —— 这是整组一致性的来源。
REFERENCE = "01-idle"

ROLE = (
    "CHARACTER (must stay identical in every image): a single round squishy blob mascot "
    "creature in vivid royal blue #4262F3, smooth glossy surface with one soft specular "
    "highlight on the upper left, two small stubby arms, two short stubby feet, no ears, "
    "no tail. Two large perfectly circular pure white eyes, each with a small dark navy "
    "pupil, and a tiny simple smiling mouth."
)

STYLE = (
    "STYLE: modern flat mascot illustration, soft cel shading, clean rounded shapes, thin "
    "clean linework, glossy highlight, extremely readable at small size.\n"
    "BACKGROUND: flat solid uniform magenta #FF00FF filling every corner, absolutely no "
    "gradient, no shadow, no reflection, no ground plane.\n"
    "Full body, front view, centered horizontally, generous even margin. No text, no "
    "watermark, no border."
)

# 漂在与身体同色的深蓝符号，在深色主题下等于没有。必须自带高对比描边。
PROP_RULE = (
    "PROP RULE: the floating symbol must be a LARGE BOLD bright warm yellow #FFC53D shape "
    "surrounded by a thick dark navy outline, so it stays clearly visible on a dark "
    "background as well as a light one. It must NOT be blue and must NOT be subtle."
)

# 帧序号 → 姿态描述。文件名前缀决定图集里的行序，不要重排。
POSES: list[tuple[str, str]] = [
    ("01-idle", (
        "neutral standing idle, both eyes fully open and round, arms relaxed at the sides, "
        "calm friendly expression."
    )),
    ("02-blink", (
        "identical standing pose, identical framing and identical body as the reference "
        "image, but BOTH eyes fully closed: each eye becomes a thin downward-curving closed "
        "line in exactly the same size and position as the open eye. Nothing else changes "
        "at all."
    )),
    ("03-working", (
        "leaning slightly forward, cheerfully busy and hard at work, both stubby arms raised "
        "in front with little fists, eyes wide open and bright, looking attentively down at "
        "its hands, with an eager friendly determined look — cheerful and keen, definitely "
        "NOT angry, NOT frowning, no angry eyebrows. Two short bold bright yellow speed lines "
        "with dark navy outlines beside the arms."
    )),
    ("04-attention", (
        "one stubby arm raised high and waving to get attention, body tilted slightly, eyes "
        "wide open and alert, and one large bold exclamation mark floating clearly above the "
        "head. " + PROP_RULE
    )),
    ("05-done", (
        "both stubby arms raised up celebrating, a small happy hop, eyes closed as "
        "upward-curving happy arcs, two small simple sparkles floating above the head."
    )),
    ("06-approval", (
        "standing still waiting patiently for a decision, body tilted slightly to one side, "
        "eyes open and looking slightly upward, and one large bold question mark floating "
        "clearly above the head. " + PROP_RULE
    )),
]

# 图集行序，必须与 POSES 的前缀顺序一致，也必须是插件会向资源包索取的状态 id。
ATLAS_ORDER = ["idle", "blink", "working", "attention", "done", "approval"]

# 画布规格。**按内容实际形状定，不要照抄内置精灵的 9:16**：团子接近方形，
# 照抄会让【宽度】成为约束、人物只占半格高。这里高度要容得下飘得最高的道具，
# 同时保证宽度仍是约束条件 —— 否则道具会把所有帧的人物一起压小。
CANVAS = (384, 512)          # 每格像素；512/384 = 4/3，显示高度 132×512/384 = 176 是整数
FIT = (0.90, 0.90)           # 内容最多占画布的比例
BASELINE = 0.94              # 内容底边落在画布高度的这个位置
