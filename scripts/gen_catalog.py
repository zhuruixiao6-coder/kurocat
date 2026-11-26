# -*- coding: utf-8 -*-
"""把《全量配置 + 全量排序》脚本化成可发货的商品目录。

输出两份：
- src/shop.json            前端用（含 shape / 配色，用于画 1:1 预览图）
- src-tauri/src/shop_table.rs  Rust 用（价格、上架周、触发，用于校验购买）

一周一更：每个 SKU 带 week 字段，week=0 是首发（当前已上架），
之后按《分批汇总》的批次铺到第 10 周，客户端只显示 week <= 本周 的商品。
"""
import json
import os
import re
import collections
import openpyxl

SRC = r"C:\Users\Administrator\Doubao\chats\2026-11-24\new-chat-1"
OUT_JSON = r"F:\AI_Workspace\kurocat\src\shop.json"
OUT_RS = r"F:\AI_Workspace\kurocat\src-tauri\src\shop_table.rs"

acc = json.load(open(os.path.join(SRC, "KuroCat_配饰配置_全量.json"), encoding="utf-8"))["items"]
fx = json.load(open(os.path.join(SRC, "KuroCat_特效配置_全量.json"), encoding="utf-8"))["items"]

# ---------- 1) 从排序表拿「上架顺序 / 批次」 ----------
wb = openpyxl.load_workbook(os.path.join(SRC, "KuroCat_全量排序_1100个.xlsx"), read_only=True)
ws = wb["全量排序(1100)"]
order = {}
for r in ws.iter_rows(min_row=4, values_only=True):
    if not r[2] or r[2] == "SKU":
        continue
    order[r[2]] = (int(r[0]), str(r[1]))
wb.close()

BATCH_WEEK = {
    "已在架": (0, 0),
    "首发": (0, 0),
    "第1批": (1, 1),
    "第2批": (2, 2),
    "第3批": (3, 3),
    "第4批": (4, 4),
    "第5–6批": (5, 6),
    "第7–8批": (7, 8),
    "第9–10批": (9, 10),
}
# 大批次按顺序对半拆到两周
group_pos = collections.Counter()
group_size = collections.Counter(v[1] for v in order.values())


def week_of(name: str) -> int:
    o, batch = order.get(name, (9999, "第9–10批"))
    a, b = BATCH_WEEK.get(batch, (10, 10))
    if a == b:
        return a
    group_pos[batch] += 1
    return a if group_pos[batch] <= group_size[batch] // 2 + 1 else b


# ---------- 2) 配色 ----------
VARIANTS = {"经典": None, "奶白": "#F8F5EF", "樱粉": "#FFB7C5", "薄荷": "#A7F3D0", "午夜": "#1F2937"}

COLOR_WORDS = [
    ("樱粉", "#FFB7C5"), ("粉", "#F2A0BC"), ("奶白", "#F8F5EF"), ("白", "#F4F6FA"),
    ("薄荷", "#A7F3D0"), ("绿", "#7FBF7A"), ("午夜", "#1F2937"), ("黑", "#2A2B31"),
    ("蓝", "#4E7FD0"), ("青", "#63C7D6"), ("紫", "#8E6BD6"), ("金", "#F0C24A"),
    ("黄", "#F2CE5C"), ("橙", "#EE8B4B"), ("红", "#D45A5A"), ("棕", "#A9784E"),
    ("灰", "#A7ADB8"), ("银", "#C8CEDA"), ("米", "#E2D4BC"), ("玫", "#D6608A"),
]


def hex2rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def rgb2hex(v):
    return "#%02X%02X%02X" % tuple(max(0, min(255, int(round(x)))) for x in v)


def shade(h, k):
    r, g, b = hex2rgb(h)
    return rgb2hex([r * k, g * k, b * k])


PALETTE = [
    "#4E7FD0", "#D45A5A", "#6FA86A", "#E2A33C", "#8E6BD6", "#3FA3A8",
    "#C4698C", "#8A6A4E", "#5B6B8C", "#B5654A", "#5E8FA8", "#9A8C3F",
]


def name_hash(text: str) -> int:
    h = 0
    for ch in text:
        h = (h * 131 + ord(ch)) & 0x7FFFFFFF
    return h


EXPLICIT = {
    "云朵垫": "#EAF2FF", "草地": "#7FBF7A", "竹席": "#C8B06A", "榻榻米": "#D9C79E",
    "月球表面": "#C9C9D4", "泡泡池": "#BFE8FF", "秋叶堆": "#C77B3A", "雨后水洼": "#9FD0FF",
    "波斯小毯": "#B5586A", "瓷砖地": "#D8DDE6", "星光台": "#46549C", "雪地小坑": "#EAF4FF",
    "圆形坐垫": "#4F6AD6", "毛绒地毯": "#B5586A", "纸箱": "#B98A56", "野餐垫": "#E05A5A",
    "沙滩垫": "#F0C96A", "小木屋": "#9A6B46", "猫爬架底座": "#C8A97A", "气球束": "#E85A8A",
    "小天使翅膀": "#F2F6FC", "恶魔翅膀": "#3A2030", "蝴蝶翅膀": "#F7A8D8", "蜜蜂翅膀": "#F2D24A",
    "蜻蜓翅膀": "#8FD5FF", "火箭背包": "#B8BEC9", "小龟壳": "#7A9A5A", "小披风": "#8F1F2E",
    "斗篷": "#5B3A6E", "小背包": "#5A7A4A", "双肩书包": "#C94F4F", "滑翔翼": "#E8B23A",
    "箭筒": "#8A5A2B", "小吉他": "#B8623A", "竹篓": "#C8A86A", "冲浪板": "#4AB8C8",
    "小旗子": "#D45A5A", "降落伞": "#E86A5A", "小灯笼": "#E85A3A", "毛线球": "#E98FB0",
    "小鱼干": "#D8C8A0", "咖啡杯": "#F4F6FA", "小书本": "#8F3A4A", "小雨伞": "#5AA9D8",
    "逗猫棒": "#E8A0C0", "手机": "#2A2B31", "小键盘": "#3A3D46", "铅笔": "#E8B23A",
    "便签本": "#F4F6FA", "茶杯": "#F4F6FA", "甜甜圈": "#E8A0B8", "棒棒糖": "#E85A8A",
    "气球": "#E85A6A", "小鱼缸": "#9FD8F0", "望远镜": "#4A4E58", "相机": "#3A3D46",
    "扳手": "#A8B0BC", "药瓶": "#F0F4F8", "麦克风": "#2A2B31",
    # ---- 按参考图指定主色（避免哈希出白色/棕色乱配）----
    "棒球帽": "#2A3550", "针织毛线帽": "#EFE6D2", "贝雷帽": "#33405C",
    "女巫帽": "#4A2B5E", "睡帽": "#E9EDF6", "派对尖帽": "#F2C94C",
    "水手帽": "#F2F4F2", "青蛙头套": "#6FA85E", "厨师帽": "#F4F2EC",
    "猫耳发箍": "#1E1F24", "兔耳发箍": "#F6F2EA", "鹿角发箍": "#8A5A32",
    "耳罩": "#EFE7D8", "牛仔帽": "#7A5232", "卫衣兜帽": "#4E5560",
    "骑士头盔": "#9AA2AE", "小皇冠": "#D9A93C", "花环": "#7FA86A",
    "南瓜帽": "#D97B2E", "草帽": "#D8C08A",
    "铃铛项圈": "#6B2E2A", "学院领结": "#7A1F2E", "格纹围巾": "#B03A3A",
    "领带": "#2A3550", "运动毛巾": "#F2F4F2", "珍珠项链": "#F6F1E4",
    "小雨衣领": "#E8B23A", "三角领巾": "#C0453F", "围脖": "#D9CDB8",
    "毛领": "#EFE6D6", "星形吊坠": "#D9B23C", "长围巾": "#8E9AAE",
    "圆框眼镜": "#3A3D46", "心形墨镜": "#E0559A", "电竞护目镜": "#2A2F38",
    "像素墨镜": "#2A2B31", "猫眼美瞳": "#6FA8C8", "小口罩": "#DDE6F0",
    "腮红贴": "#E8A0A8", "半脸面具": "#F2F4F8", "单片眼镜": "#C8A24A",
    "潜水镜": "#2E7FB8", "单眼眼罩": "#1E1F24",
    "小天使翅膀": "#F6F4EE", "恶魔翅膀": "#3A2030", "蝴蝶翅膀": "#E8A0C8",
    "蜜蜂翅膀": "#F2D24A", "蜻蜓翅膀": "#8FD5FF", "小背包": "#5A7A4A",
    "双肩书包": "#C94F4F", "小披风": "#8F2230", "斗篷": "#3E2A48",
    "火箭背包": "#B8BEC9", "小龟壳": "#7A9A5A", "滑翔翼": "#E8B23A",
    "小袜子": "#F2F4F2", "小雨靴": "#E8B23A", "爪环": "#C8A24A",
    "小拖鞋": "#E8A0B8", "毛绒爪套": "#EFE6D6", "护腕": "#2A3550",
    "爪链": "#C8A24A", "雪地靴": "#8A6A4E", "运动鞋": "#F2F4F2",
    "洞洞鞋": "#5AA9D8", "爪部绑带": "#B03A3A", "爪戒": "#C8A24A",
    "圆形坐垫": "#4F6AD6", "毛绒地毯": "#B5586A", "纸箱": "#B98A56",
    "猫爬架底座": "#C8A97A", "小木屋": "#9A6B46", "野餐垫": "#E05A5A",
    "雪地小坑": "#EAF4FF", "沙滩垫": "#F0C96A", "竹席": "#C8B06A",
    "榻榻米": "#D9C79E", "圆木墩": "#8A6A4E", "波斯小毯": "#B5586A",
}


def base_color(text: str, fallback: str) -> str:
    for key, hx in EXPLICIT.items():
        if text.startswith(key):
            return hx
    for word, hx in COLOR_WORDS:
        if word in text:
            return hx
    # 名字里没有颜色信息时，用名字哈希稳定地挑一个颜色，避免整批都是白色
    return PALETTE[name_hash(text) % len(PALETTE)]


DEFAULT_BY_SLOT = {
    "head": "#4E7FD0", "face": "#3A3D46", "neck": "#D45A5A", "back": "#F4F6FA",
    "paw": "#F4F6FA", "floor": "#7D8AB8", "prop": "#C9A06A",
}

# ---------- 3) 基础款 → 造型 ----------
SHAPE = {
    # head
    "棒球帽": "cap", "针织毛线帽": "beanie", "女巫帽": "coneHat", "厨师帽": "chefHat",
    "青蛙头套": "hood", "猫耳发箍": "earband", "鹿角发箍": "antler", "派对尖帽": "partyHat",
    "小皇冠": "crown", "睡帽": "nightcap", "耳罩": "earmuff",
    "水手帽": "sailorCap", "草帽": "sunhat", "兔耳发箍": "bunnyEars", "贝雷帽": "beret",
    "骑士头盔": "helmet", "花环": "wreath", "牛仔帽": "cowboyHat", "卫衣兜帽": "hoodie",
    "南瓜帽": "pumpkin",
    # face
    "圆框眼镜": "glassesRound", "心形墨镜": "glassesHeart", "电竞护目镜": "goggles",
    "单眼眼罩": "eyePatch", "小口罩": "mask", "腮红贴": "blush", "像素墨镜": "glassesPixel",
    "猫眼美瞳": "eyewear", "星星眼贴": "sticker", "半脸面具": "mask", "单片眼镜": "monocle",
    "潜水镜": "goggles", "面纱": "veil", "雪花贴": "sticker", "泪滴贴": "sticker",
    "猫须贴": "whiskerSticker", "彩虹眼影": "eyeshadow", "蒸汽风镜": "goggles",
    "3D 眼镜": "glassesPixel", "眼线贴": "eyeliner",
    # neck
    "铃铛项圈": "collarBell", "学院领结": "bowtie", "格纹围巾": "scarf", "领带": "tie",
    "运动毛巾": "towel", "珍珠项链": "pearl", "小雨衣领": "rainCollar", "三角领巾": "bandana",
    "围脖": "snood", "毛领": "furCollar", "星形吊坠": "pendant", "长围巾": "scarf",
    "防风围脖": "snood", "蕾丝领": "laceCollar", "铭牌项圈": "nameTag", "双色围巾": "scarf",
    "医疗颈托": "neckBrace", "蕾丝颈环": "laceCollar", "羽毛围巾": "furCollar", "围兜": "bib",
    # back
    "小天使翅膀": "wingsAngel", "恶魔翅膀": "wingsDevil", "蝴蝶翅膀": "wingsButterfly",
    "蜜蜂翅膀": "wingsBee", "蜻蜓翅膀": "wingsBee", "小背包": "backpack", "双肩书包": "backpack",
    "小披风": "cape", "斗篷": "cape", "火箭背包": "jetpack", "小龟壳": "shell",
    "滑翔翼": "glider", "箭筒": "flag", "小吉他": "flag", "小旗子": "flag",
    "降落伞": "parachute", "小灯笼": "lantern", "竹篓": "basket", "冲浪板": "surfboard",
    "气球束": "balloons",
    # paw
    "小袜子": "sock", "小雨靴": "boot", "爪环": "cuff", "小拖鞋": "slipper",
    "毛绒爪套": "plushPaw", "护腕": "wristband", "爪链": "cuff", "雪地靴": "boot",
    "运动鞋": "sneaker", "洞洞鞋": "slipper", "爪部绑带": "wristband", "爪戒": "ring",
    "爪印贴纸": "pawSticker", "拳套": "glove", "溜冰鞋": "sneaker", "铃铛爪环": "cuff",
    "脚镯": "ring", "爪尖美甲": "nails", "针织腿套": "sock", "雨鞋套": "boot",
    # floor
    "圆形坐垫": "cushion", "毛绒地毯": "rug", "纸箱": "box", "猫爬架底座": "treeBase",
    "小木屋": "cabin", "野餐垫": "mat", "雪地小坑": "snowPit", "沙滩垫": "mat",
    "竹席": "mat", "榻榻米": "mat", "圆木墩": "cushion", "波斯小毯": "rug",
    "瓷砖地": "rug", "月球表面": "snowPit", "云朵垫": "cushion", "泡泡池": "snowPit",
    "秋叶堆": "snowPit", "草地": "rug", "雨后水洼": "snowPit", "星光台": "treeBase",
    # prop
    "小鱼干": "propFish", "咖啡杯": "propCup", "小书本": "propBook", "毛线球": "propYarn",
    "小雨伞": "propUmbrella", "逗猫棒": "wand", "手机": "phone", "小键盘": "miniKeyboard",
    "铅笔": "pencil", "便签本": "notepad", "茶杯": "propCup", "甜甜圈": "donut",
    "棒棒糖": "lollipop", "气球": "balloon", "小鱼缸": "fishbowl", "望远镜": "telescope",
    "相机": "camera", "扳手": "wrench", "药瓶": "pillBottle", "麦克风": "mic",
}

SLOT_DEFAULT_SHAPE = {
    "head": "cap", "face": "glassesRound", "neck": "collarBell", "back": "wingsAngel",
    "paw": "sock", "floor": "cushion", "prop": "propBook",
}

# ---------- 4) 特效：图标 + 运动 ----------
FX_ICON = [
    ("字母", "🔤"), ("星星", "⭐"), ("爱心", "💗"), ("心", "💗"), ("花瓣", "🌸"), ("樱", "🌸"),
    ("雪", "❄️"), ("雨", "🌧️"), ("叶", "🍁"), ("气泡", "🫧"), ("泡泡", "🫧"), ("音符", "🎵"),
    ("硬币", "🪙"), ("金币", "🪙"), ("鱼", "🐟"), ("爪", "🐾"), ("闪电", "⚡"), ("火焰", "🔥"),
    ("火", "🔥"), ("烟花", "🎆"), ("彩带", "🎊"), ("礼花", "🎊"), ("咖啡", "☕"), ("豆", "☕"),
    ("尘", "✨"), ("星尘", "✨"), ("光环", "◯"), ("涟漪", "◯"), ("波纹", "◯"), ("霓虹", "🔷"),
    ("代码", "💻"), ("数字", "🔢"), ("问号", "❓"), ("感叹", "❗"), ("汗", "💧"), ("睡", "💤"),
    ("云", "💭"), ("雾", "💨"), ("蒸汽", "💨"), ("彩虹", "🌈"), ("极光", "🌈"), ("月亮", "🌙"),
    ("月光", "🌙"), ("太阳", "🌅"), ("灯笼", "🏮"), ("萤火", "✨"), ("枯叶", "🍂"), ("泡泡糖", "🍬"),
    ("钻石", "💎"), ("皇冠", "👑"), ("奖杯", "🏆"), ("奖", "🏆"), ("爆", "💥"), ("冲刺", "💫"),
    ("漩涡", "🌀"), ("流星", "🌠"), ("像素", "👾"), ("手套", "🧤"), ("铃", "🔔"), ("玫瑰", "🌹"),
    ("蛋糕", "🍰"), ("糖果", "🍬"), ("蒲公英", "🌼"), ("猫", "🐱"), ("书", "📖"), ("笔", "✒️"),
]

MOTIONS = [
    ("下落", "fall"), ("下坠", "fall"), ("上浮", "rise"), ("上升", "rise"), ("上抛", "rise"),
    ("环绕", "orbit"), ("旋转", "orbit"), ("四散", "burst"), ("扩散", "burst"), ("迸发", "burst"),
    ("拖尾", "trail"), ("波纹", "ring"), ("涟漪", "ring"), ("呼吸", "aura"), ("循环", "aura"),
    ("常驻", "aura"), ("闪烁", "pop"), ("弹", "pop"),
]

# ---------- 5) 触发方式：统一成「按操作」 ----------
TRIGGER_MAP = {
    "常驻": "常戴",
    "雨天自动": "挂机时",
    "夜间自动(19:00-6:00)": "挂机时",
    "夜间/挂机 10 分钟": "挂机时",
    "夜间 / 高好感": "挂机时",
    "12 月自动": "常戴",
    "冬季/低温": "常戴",
    "节日/成就瞬间": "累计 500 键",
    "等级 30 后常戴": "累计 3000 键",
    "游戏时自动": "连击时",
    "着凉/低状态": "挂机时",
    "夜间 20:00 后": "挂机时",
}
OPERATION_TRIGGERS = {
    "常戴", "点击切换", "打字时", "连击时", "挂机时", "连续打字 30 秒", "点击猫之后",
    "喂食之后", "鼠标停在头上", "睡醒时", "点击猫", "按退格", "每次按键",
}


def normalize_trigger(t: str) -> str:
    t = (t or "").strip()
    if t in OPERATION_TRIGGERS:
        return "点击猫之后" if t == "点击猫" else t
    if t in TRIGGER_MAP:
        return TRIGGER_MAP[t]
    if re.match(r"^每\s*\d+\s*(键|次按键)$", t):
        return t.replace("次按键", "键").replace(" ", "")
    if "连击" in t or "高速" in t:
        return "连击时"
    if "打字" in t:
        return "打字时"
    if "点击" in t or "触摸" in t or "互动" in t:
        return "点击猫之后"
    if "喂" in t or "吃" in t:
        return "喂食之后"
    if "睡" in t or "醒" in t:
        return "睡醒时"
    if "启动" in t or "唤醒" in t:
        return "睡醒时"
    if "好感" in t or "等级" in t or "成就" in t:
        return "累计 500 键"
    return "常戴"


def base_name(name: str) -> str:
    return name.split("·")[0].strip()


def variant_name(name: str) -> str:
    parts = name.split("·")
    return parts[1].strip() if len(parts) > 1 else "经典"


# 配饰只保留基础款（去掉「奶白 / 樱粉 / 薄荷 / 午夜」这些配色变体），
# 统一用「经典」那一件，名字也去掉 ·经典 后缀。
items = []
for it in acc:
    bn = base_name(it["name_cn"])
    vn = variant_name(it["name_cn"])
    if vn != "经典":
        continue
    slot_raw = it["slot"]
    slot = slot_raw
    shape = SHAPE.get(bn, SLOT_DEFAULT_SHAPE.get(slot, "propBook"))
    base_hue = base_color(bn + it.get("desc", "") + it.get("art_note", ""), DEFAULT_BY_SLOT.get(slot, "#8A8FA0"))
    v = VARIANTS.get(vn)
    c1 = v or base_hue
    if v and vn in ("奶白", "午夜"):
        c2 = shade(v, 0.80 if vn == "奶白" else 1.55)
    else:
        c2 = shade(c1, 0.74)
    items.append({
        "id": it["id"],
        "name": bn,
        "kind": "equip",
        "slot": slot,
        "shape": shape,
        "c1": c1,
        "c2": c2,
        "price": max(5, int(round(it["price"] / 10))),
        "rarity": it.get("rarity", "普通"),
        "trigger": normalize_trigger(it.get("trigger")),
        "week": week_of(it["name_cn"]),
        "desc": it.get("desc", ""),
        "icon": "",
        "motion": "",
    })

for it in fx:
    bn = base_name(it["name_cn"])
    vn = variant_name(it["name_cn"])
    icon = "✨"
    for word, emo in FX_ICON:
        if word in bn:
            icon = emo
            break
    motion = "pop"
    mv = it.get("motion", "")
    for word, m in MOTIONS:
        if word in mv:
            motion = m
            break
    pal = it.get("palette", "")
    m = re.search(r"#[0-9A-Fa-f]{6}", pal)
    v = VARIANTS.get(vn)
    color = v or (m.group(0) if m else "#FFD66B")
    items.append({
        "id": it["id"],
        "name": it["name_cn"],
        "kind": "effect",
        "slot": "fx",
        "shape": "fx",
        "c1": color,
        "c2": shade(color, 0.74),
        "price": max(5, int(round(it["price"] / 10))),
        "rarity": it.get("rarity", "普通"),
        # 特效统一常驻：不再有「每 N 键 / 连击 / 挂机」这类前置条件
        "trigger": "常驻 · 按下即显示",
        "week": week_of(it["name_cn"]),
        "desc": it.get("desc", ""),
        "icon": icon,
        "motion": motion,
    })

items.sort(key=lambda x: (x["week"], x["id"]))
weeks = collections.Counter(i["week"] for i in items)
print("total", len(items), "weeks", sorted(weeks.items()))

payload = {
    "version": 2,
    "epoch": "2026-11-24",
    "weeks": max(weeks) + 1,
    "items": items,
}
with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
print("shop.json", round(os.path.getsize(OUT_JSON) / 1024, 1), "KB")


def rs(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


lines = [
    "// 由 scripts/gen_catalog.py 生成，勿手改。",
    "use crate::profile::ShopItem;",
    "",
    "pub static SHOP: &[ShopItem] = &[",
]
for i in items:
    lines.append("    ShopItem {")
    lines.append(f'        id: "{rs(i["id"])}",')
    lines.append(f'        name: "{rs(i["name"])}",')
    lines.append(f'        desc: "{rs(i["desc"])}",')
    lines.append(f'        kind: "{i["kind"]}",')
    lines.append(f'        slot: "{i["slot"]}",')
    lines.append(f'        trigger: "{rs(i["trigger"])}",')
    lines.append(f'        rarity: "{i["rarity"]}",')
    lines.append(f'        week: {i["week"]},')
    lines.append(f'        price: {i["price"]},')
    lines.append("    },")
lines.append("];")
with open(OUT_RS, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print("shop_table.rs", round(os.path.getsize(OUT_RS) / 1024, 1), "KB")
print("shapes used:", len({i['shape'] for i in items}))
print("missing shape art:", sorted({i['shape'] for i in items} - set(SHAPE.values())))
