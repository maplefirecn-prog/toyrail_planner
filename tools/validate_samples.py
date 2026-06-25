import json
from pathlib import Path

try:
    import jsonschema
except ModuleNotFoundError:
    jsonschema = None


ROOT = Path(__file__).resolve().parents[1]


def load_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main():
    catalog_schema = load_json(ROOT / "schemas" / "catalog.schema.json")
    project_schema = load_json(ROOT / "schemas" / "project.schema.json")
    catalog = load_json(ROOT / "data" / "sample-catalog.tomix-demo.json")
    tomix_catalog = load_json(ROOT / "data" / "tomix-fine-track.catalog.json")
    project = load_json(ROOT / "data" / "sample-project.demo.json")

    if jsonschema:
      jsonschema.Draft202012Validator(catalog_schema).validate(catalog)
      jsonschema.Draft202012Validator(catalog_schema).validate(tomix_catalog)
      jsonschema.Draft202012Validator(project_schema).validate(project)
    else:
      validate_catalog_basic(catalog)
      validate_catalog_basic(tomix_catalog)
      validate_project_basic(project)
    print("Sample catalog/project files are valid.")


def validate_catalog_basic(catalog):
    assert catalog["schema"] == "raildesign.catalog.v1"
    assert catalog["units"] == "mm"
    assert catalog["catalogId"]
    assert catalog["manufacturer"]
    assert isinstance(catalog["connectorProfiles"], list) and catalog["connectorProfiles"]
    assert isinstance(catalog["pieces"], list) and catalog["pieces"]
    for piece in catalog["pieces"]:
        assert piece["id"]
        assert piece["sku"]
        assert piece["kind"]
        if piece["kind"].startswith("track."):
            geometry = piece["geometry"]
            assert isinstance(geometry["connectors"], list) and len(geometry["connectors"]) >= 2
            assert isinstance(geometry["routes"], list) and geometry["routes"]
            for connector in geometry["connectors"]:
                for key in ["id", "x", "y", "z", "yawDeg", "profile"]:
                    assert key in connector
            for route in geometry["routes"]:
                assert route["connectorIds"]
                assert route["segments"]
        if piece["kind"].startswith("accessory."):
            assert "dimensions" in piece


def validate_project_basic(project):
    assert project["schema"] == "raildesign.project.v1"
    assert project["units"] == "mm"
    assert project["projectId"]
    assert project["name"]
    assert project["board"]["widthMm"] > 0
    assert project["board"]["heightMm"] > 0
    assert isinstance(project["catalogRefs"], list)
    assert isinstance(project["placements"], list)
    assert isinstance(project["connections"], list)
    placement_ids = {placement["id"] for placement in project["placements"]}
    for placement in project["placements"]:
        for key in ["id", "pieceId", "x", "y", "z", "yawDeg"]:
            assert key in placement
    for connection in project["connections"]:
        assert connection["from"]["placementId"] in placement_ids
        assert connection["to"]["placementId"] in placement_ids


if __name__ == "__main__":
    main()
