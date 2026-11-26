#!/usr/bin/env python3
"""按「已重新建模」白名单筛掉尚未重建的 3D 模型。

标准（可复核）：
  一个形状算「已重新建模」，当且仅当它走独立的精细构建器
  （build*Fine），或在最近一轮里被手工重做过（厨师帽 / 发箍 / 鹿角 / 面部 10 件 / 三种翅膀）。
  其余形状（早期用基础几何拼的占位模型）一律从商店与 Rust 商品表里移除。

产物：
  src/shop.json                 前端目录（已过滤）
  src-tauri/src/shop_table.rs   Rust 商品表（已过滤）
  scripts/model_filter_report.json  保留 / 移除清单，便于回溯
完整原始数据保存在 src/shop.full.backup.json（gen_catalog.py 可随时重生成）。
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOP = os.path.join(ROOT, "src", "shop.json")
RS = os.path.join(ROOT, "src-tauri", "src", "shop_table.rs")
REPORT = os.path.join(ROOT, "scripts", "model_filter_report.json")

KEEP = {
    "head": {
        "cap", "beanie", "coneHat", "partyHat", "sailorCap", "bunnyEars",
        "cowboyHat", "hoodie", "crown", "nightcap",
        # 本轮重做
        "chefHat", "earband", "antler",
    },
    "face": {
        "glassesRound", "glassesHeart", "goggles", "glassesPixel", "eyePatch", "mask",
        # 本轮重做
        "blush", "eyewear", "sticker", "monocle", "whiskerSticker", "eyeliner",
        "eyeshadow", "veil",
    },
    "neck": {"collarBell", "bowtie", "scarf"},
    "back": {
        "wingsAngel", "backpack", "cape",
        # 本轮重做
        "wingsButterfly", "wingsDevil", "wingsBee",
    },
    "paw": {"sock", "boot"},
    "floor": {"cushion"},
    "prop": {
        "propFish", "propCup", "propBook", "propYarn", "propUmbrella", "wand", "phone",
        "donut", "lollipop", "balloon", "camera", "mic", "telescope", "wrench",
        "pillBottle", "miniKeyboard", "notepad", "fishbowl", "pencil",
    },
}


def rs_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def main() -> None:
    data = json.load(open(SHOP, encoding="utf-8"))
    items = data["items"]
    kept: list[dict] = []
    removed: list[dict] = []
    for it in items:
        if it.get("kind") != "equip":
            kept.append(it)  # 特效不是模型，整批保留
            continue
        (kept if it.get("shape") in KEEP.get(it.get("slot", ""), set()) else removed).append(it)

    data["items"] = kept
    json.dump(data, open(SHOP, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    lines = [
        "// 由 scripts/gen_catalog.py 生成，勿手改。",
        "use crate::profile::ShopItem;",
        "",
        "pub static SHOP: &[ShopItem] = &[",
    ]
    for it in kept:
        lines += [
            "    ShopItem {",
            f'        id: "{rs_escape(it["id"])}",',
            f'        name: "{rs_escape(it["name"])}",',
            f'        desc: "{rs_escape(it.get("desc", ""))}",',
            f'        kind: "{rs_escape(it["kind"])}",',
            f'        slot: "{rs_escape(it["slot"])}",',
            f'        trigger: "{rs_escape(it.get("trigger", ""))}",',
            f'        rarity: "{rs_escape(it.get("rarity", ""))}",',
            f'        week: {int(it.get("week", 0))},',
            f'        price: {int(it.get("price", 0))},',
            "    },",
        ]
    lines += ["];", ""]
    open(RS, "w", encoding="utf-8", newline="\n").write("\n".join(lines))

    report = {
        "standard": "拥有独立精细构建器(build*Fine)或本轮手工重做",
        "kept": [{"id": i["id"], "name": i["name"], "slot": i["slot"], "shape": i["shape"]} for i in kept if i.get("kind") == "equip"],
        "removed": [{"id": i["id"], "name": i["name"], "slot": i["slot"], "shape": i["shape"]} for i in removed],
        "keptFx": sum(1 for i in kept if i.get("kind") != "equip"),
    }
    json.dump(report, open(REPORT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"kept equip={len(report['kept'])} fx={report['keptFx']} removed={len(removed)}")


if __name__ == "__main__":
    main()
