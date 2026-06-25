import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "tomix-fine-track.catalog.json"


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    pieces = catalog["pieces"]
    names = [piece["name"] for piece in pieces]
    japanese = [
        piece
        for piece in pieces
        if re.search(r"[\u3040-\u30ff]", piece["name"])
    ]
    duplicates = [
        (name, count)
        for name, count in Counter(names).items()
        if count > 1
    ]
    left_right_ids = [
        piece["id"]
        for piece in pieces
        if piece["id"].endswith("-l") or piece["id"].endswith("-r")
    ]

    print(f"pieces={len(pieces)}")
    print(f"japanese_display_names={len(japanese)}")
    print(f"duplicate_display_names={len(duplicates)}")
    print(f"left_right_variant_ids={len(left_right_ids)}")
    if japanese:
        print("Japanese display names:")
        for piece in japanese[:20]:
            print(f"- {piece['sku']}: {piece['name']}")
    if duplicates:
        print("Duplicate display names:")
        for name, count in duplicates[:20]:
            print(f"- {name}: {count}")


if __name__ == "__main__":
    main()
