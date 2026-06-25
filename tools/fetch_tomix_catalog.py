import html
import json
import math
import re
import unicodedata
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
BASE = "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi"
INTRO = "https://www.tomytec.co.jp/tomix/nyumon/tomixrail.html"
PROFILE = "tomix-fine-track"
CATALOG_ID = "tomix.fine-track.n.official-list"
VERSION = f"{date.today().isoformat()}-official-list"

CATEGORIES = {
    "rail_std": "Basic rails",
    "rail_point": "Turnouts",
    "rail_spc": "Special rails",
    "rail_double": "Double track rails",
    "rail_slab": "Slab rails",
    "rail_wpc": "Wide PC rails",
    "rail_mini": "Super mini and mini curve rails",
    "rail_tram": "Wide tram rails",
    "rail_relation": "Rail related products",
}


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        text = data.strip()
        if text:
            self.parts.append(text)


def fetch_parts(url):
    request = Request(url, headers={"User-Agent": "RailDesignLocalMVP/1.0"})
    with urlopen(request, timeout=20) as response:
        raw = response.read()
    parser = TextParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    return parser.parts


def source(url, confidence="official"):
    return {
        "url": url,
        "title": "TOMIX Fine Track official lineup",
        "retrievedAt": date.today().isoformat(),
        "confidence": confidence,
    }


def piece_id(sku):
    return "tomix.fine-track." + sku.lower().replace("．", ".").replace("・", "-").replace(" ", "-")


def fmt_number(value):
    return ("%g" % value)


def normalize_product_name(name):
    text = unicodedata.normalize("NFKC", name)
    text = text.replace("・", "-").replace("゜", "°")
    text = re.sub(r"画像なし", "", text)
    text = re.sub(r"\([^)]*本(?:セット|2組|.*?セット)?[^)]*\)", "", text)
    text = re.sub(r"\(各\d+[^)]*\)", "", text)
    text = re.sub(r"\(F\)", "", text)
    text = re.sub(r"\s+", "", text)
    return text


def family_label(raw_name, kind):
    text = normalize_product_name(raw_name)
    labels = []
    if "複線" in text:
        labels.append("复线")
    if "高架橋付" in text:
        labels.append("高架")
    if "ワイドPC" in text:
        labels.append("宽PC")
    elif "PC" in text:
        labels.append("PC")
    if "スラブ" in text:
        labels.append("板式")
    if "ミニ" in text:
        labels.append("迷你")
    if "スーパーミニ" in text:
        labels.append("超迷你")
    labels.append(kind)
    return "".join(labels)


def model_name(raw_name, fallback):
    text = normalize_product_name(raw_name)
    patterns = [
        r"N-P[LR]\d+(?:\.\d+)?-\d+(?:\.\d+)?",
        r"DC\d+(?:\.\d+)?-\d+(?:\.\d+)?-\d+(?:\.\d+)?(?:-[A-Z]+)?",
        r"D?S\d+(?:\.\d+)?(?:-[A-Z]+)?",
        r"H?C\d+(?:\.\d+)?-\d+(?:\.\d+)?(?:-[A-Z]+)?",
        r"H?S\d+(?:\.\d+)?(?:-[A-Z]+)?",
        r"V\d+(?:\.\d+)?(?:-[A-Z]+)?",
        r"X[LR]?\d+(?:\.\d+)?-\d+(?:\.\d+)?",
        r"[A-Z]+\d+(?:\.\d+)?(?:-[A-Z0-9]+)*",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(0)
    return fallback


def connector(x, y, yaw, cid):
    return {"id": cid, "x": round(x, 3), "y": round(y, 3), "z": 0, "yawDeg": yaw, "profile": PROFILE}


def straight_piece(sku, name, length, category, elevated=False, wide=False):
    display_name = f"{model_name(name, 'S' + fmt_number(length))} {family_label(name, '直轨')}"
    return {
        "id": piece_id(sku),
        "sku": sku,
        "name": display_name,
        "kind": "track.straight",
        "tags": ["tomix", "fine-track", "straight", category] + (["elevated"] if elevated else []) + (["wide-pc"] if wide else []),
        "geometry": {
            "connectors": [connector(0, 0, 180, "A"), connector(length, 0, 0, "B")],
            "routes": [{"id": "main", "connectorIds": ["A", "B"], "segments": [{"type": "line", "lengthMm": length}]}],
        },
        "render": {"railGaugeMm": 9, "roadbedWidthMm": 37 if wide else 18.5, "sleeperSpacingMm": 6},
        "bom": {"countAs": piece_id(sku), "quantity": 1},
        "sources": [source(f"{BASE}?category={category}&hyojimode=t")],
        "metadata": {"notes": "Geometry parsed from TOMIX product name.", "originalName": name},
    }


def curve_piece(sku, name, radius, angle, category, elevated=False, wide=False, model=None):
    direction = "left"
    sign = 1
    radians = math.radians(angle)
    x = radius * math.sin(radians)
    y = sign * radius * (1 - math.cos(radians))
    display_model = model or model_name(name, f"C{fmt_number(radius)}-{fmt_number(angle)}")
    return {
        "id": piece_id(sku if model is None else f"{sku}-{display_model}"),
        "sku": sku,
        "name": f"{display_model} {family_label(name, '曲轨')}",
        "kind": "track.curve",
        "tags": ["tomix", "fine-track", "curve", "flippable", category] + (["elevated"] if elevated else []) + (["wide-pc"] if wide else []),
        "geometry": {
            "connectors": [connector(0, 0, 180, "A"), connector(x, y, sign * angle, "B")],
            "routes": [
                {
                    "id": "main",
                    "connectorIds": ["A", "B"],
                    "segments": [{"type": "arc", "radiusMm": radius, "angleDeg": angle, "direction": direction}],
                }
            ],
        },
        "render": {"railGaugeMm": 9, "roadbedWidthMm": 37 if wide else 18.5, "sleeperSpacingMm": 6},
        "bom": {"countAs": piece_id(sku if model is None else f"{sku}-{display_model}"), "quantity": 1},
        "sources": [source(f"{BASE}?category={category}&hyojimode=t")],
        "metadata": {"notes": "Geometry parsed from TOMIX product name. Use vertical flip to use the opposite curve direction.", "originalName": name},
    }


def turnout_piece(sku, name, radius, angle, side, category):
    sign = 1 if side == "left" else -1
    radians = math.radians(angle)
    x = radius * math.sin(radians)
    y = sign * radius * (1 - math.cos(radians))
    straight_length = round(x, 3)
    return {
        "id": piece_id(sku),
        "sku": sku,
        "name": f"{model_name(name, sku)} {'左' if side == 'left' else '右'}道岔",
        "kind": "track.turnout",
        "tags": ["tomix", "fine-track", "turnout", side, category, "estimated-geometry"],
        "geometry": {
            "connectors": [
                connector(0, 0, 180, "A"),
                connector(straight_length, 0, 0, "B"),
                connector(x, y, sign * angle, "C"),
            ],
            "routes": [
                {"id": "straight", "connectorIds": ["A", "B"], "segments": [{"type": "line", "lengthMm": straight_length}]},
                {
                    "id": "diverging",
                    "connectorIds": ["A", "C"],
                    "segments": [{"type": "arc", "radiusMm": radius, "angleDeg": angle, "direction": side}],
                },
            ],
        },
        "render": {"railGaugeMm": 9, "roadbedWidthMm": 22, "sleeperSpacingMm": 6},
        "bom": {"countAs": piece_id(sku), "quantity": 1},
        "sources": [source(f"{BASE}?category={category}&hyojimode=t", "estimated")],
        "metadata": {"notes": "Turnout geometry is estimated from radius/angle in the product name and must be verified.", "originalName": name},
    }


def accessory_piece(sku, name, category, support=False):
    display_name = f"{model_name(name, sku)} {family_label(name, '支撑件' if support else '配件')}"
    return {
        "id": piece_id(sku),
        "sku": sku,
        "name": display_name,
        "kind": "accessory.support" if support else "accessory.structure",
        "tags": ["tomix", "fine-track", category] + (["support"] if support else ["rail-related"]),
        "dimensions": {},
        "placement": {"anchor": "center", "canAutoGenerate": support},
        "bom": {"countAs": piece_id(sku), "quantity": 1},
        "sources": [source(f"{BASE}?category={category}&hyojimode=t", "unknown")],
        "metadata": {"notes": "Official lineup item. Dimensions were not available on the lineup page and need product-page verification.", "originalName": name},
    }


def parse_products(parts):
    rows = []
    for index, part in enumerate(parts[:-2]):
        if not re.fullmatch(r"\d{4}", part):
            continue
        name = parts[index + 1]
        price = parts[index + 2]
        if not re.fullmatch(r"[\d,]+", price):
            continue
        if "レール" not in name and "橋脚" not in name and "架線柱" not in name and "ホーム" not in name:
            continue
        rows.append((part, html.unescape(name).replace("．", ".").strip()))
    return rows


def build_pieces(rows, category):
    pieces = []
    for sku, name in rows:
        normalized = normalize_product_name(name)
        elevated = "高架橋付" in normalized or normalized.startswith("H")
        wide = "ワイド" in normalized or "-WP" in normalized or "WP" in normalized

        straight_match = re.search(r"(?:^|[^A-Z])H?S(\d+(?:\.\d+)?)", normalized)
        double_curve_match = re.search(r"DC(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", normalized)
        curve_match = re.search(r"(?<!D)H?C(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", normalized)
        mini_curve_match = re.search(r"C(\d+(?:\.\d+)?).*?(\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)°", normalized)
        turnout_match = re.search(r"N-P([LR])(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", normalized)

        if "バリアブル" in normalized:
            pieces.append(accessory_piece(sku, name, category, support=False))
            continue

        if turnout_match:
            lr, radius, angle = turnout_match.groups()
            pieces.append(turnout_piece(sku, name, float(radius), float(angle), "left" if lr == "L" else "right", category))
            continue

        if double_curve_match:
            outer, inner, angle = double_curve_match.groups()
            radius = (float(outer) + float(inner)) / 2
            pieces.append(curve_piece(sku, name, radius, float(angle), category, elevated=elevated, wide=True, model=f"DC{outer}-{inner}-{angle}"))
            continue

        if curve_match:
            radius, angle = curve_match.groups()
            pieces.append(curve_piece(sku, name, float(radius), float(angle), category, elevated=elevated, wide=wide))
            continue

        if mini_curve_match:
            radius, angle_a, angle_b = mini_curve_match.groups()
            pieces.append(curve_piece(sku, name, float(radius), float(angle_a), category, elevated=elevated, wide=wide, model=f"C{radius}-{angle_a}"))
            pieces.append(curve_piece(sku, name, float(radius), float(angle_b), category, elevated=elevated, wide=wide, model=f"C{radius}-{angle_b}"))
            continue

        if straight_match:
            pieces.append(straight_piece(sku, name, float(straight_match.group(1)), category, elevated=elevated, wide=wide))
            continue

        support = "橋脚" in name or "架線柱" in name or "柱" in name
        pieces.append(accessory_piece(sku, name, category, support=support))
    return pieces


def main():
    pieces = []
    fetched_categories = []
    for category, label in CATEGORIES.items():
        url = f"{BASE}?category={category}&hyojimode=t"
        try:
            parts = fetch_parts(url)
        except Exception as exc:
            print(f"Skipping {category}: {exc}")
            continue
        rows = parse_products(parts)
        if rows:
            fetched_categories.append({"category": category, "label": label, "count": len(rows)})
            pieces.extend(build_pieces(rows, category))

    seen = set()
    model_seen = set()
    unique_pieces = []
    for piece in pieces:
        if piece["id"] in seen:
            continue
        model_key = json.dumps(
            {
                "name": piece["name"],
                "kind": piece["kind"],
                "geometry": piece.get("geometry"),
                "dimensions": piece.get("dimensions"),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        if model_key in model_seen:
            continue
        seen.add(piece["id"])
        model_seen.add(model_key)
        unique_pieces.append(piece)

    catalog = {
        "schema": "raildesign.catalog.v1",
        "catalogId": CATALOG_ID,
        "version": VERSION,
        "units": "mm",
        "manufacturer": "Tomix",
        "productLine": "Fine Track",
        "scale": "N",
        "gaugeMm": 9,
        "description": "TOMIX Fine Track catalog generated from the official TOMIX beginner/lineup pages. Some complex products require later product-page verification.",
        "connectorProfiles": [
            {"id": PROFILE, "name": "TOMIX Fine Track connector", "compatibleWith": [PROFILE]}
        ],
        "pieces": unique_pieces,
        "metadata": {
            "createdAt": f"{date.today().isoformat()}T00:00:00Z",
            "updatedAt": f"{date.today().isoformat()}T00:00:00Z",
            "author": "RailDesign Local MVP fetch_tomix_catalog.py",
            "notes": (
                "Base standards from TOMIX introduction page: length 140mm, roadbed width 18.5mm, "
                "double-track spacing 37mm, reference curve radius 280mm. Product geometry is parsed "
                "from product names where possible. Turnouts/accessories need further verification."
            ),
            "sourcePages": [INTRO] + [f"{BASE}?category={item['category']}&hyojimode=t" for item in fetched_categories],
            "fetchedCategories": fetched_categories,
        },
    }

    data_path = ROOT / "data" / "tomix-fine-track.catalog.json"
    js_path = ROOT / "src" / "tomix-catalog.js"
    data_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    js_path.write_text(
        "window.RailTomixCatalog = "
        + json.dumps(catalog, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {data_path} with {len(unique_pieces)} pieces")
    print(f"Wrote {js_path}")


if __name__ == "__main__":
    main()
