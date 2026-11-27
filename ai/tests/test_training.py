"""Тесты подготовки датасетов: маппинг TACO → наши классы и сплит 80/10/10."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))
import prepare  # noqa: E402


def test_maps_cover_only_known_classes():
    known = set(prepare.CLASSES)
    for name in ("taco", "trashnet"):
        vals = {v for v in prepare.load_map(name).values() if v}
        assert vals <= known, (name, vals - known)
    for _, cls in prepare.load_map("keywords"):
        assert cls in known


def test_taco_has_all_60_categories():
    assert len(prepare.load_map("taco")) == 60


def test_keyword_mapping():
    kw = prepare.load_map("keywords")
    assert prepare.keyword_class("PET bottle", kw) == "pet_bottle"
    assert prepare.keyword_class("Plastic bag", kw) == "film"
    assert prepare.keyword_class("paper", kw) == "paper"
    assert prepare.keyword_class("Battery", kw) == "hazardous"
    assert prepare.keyword_class("Aluminium can", kw) == "aluminum_can"


def test_taco_to_yolo_and_split(tmp_path: Path):
    src = tmp_path / "taco"
    (src / "batch_1").mkdir(parents=True)
    images, anns = [], []
    for i in range(20):
        Image.new("RGB", (200, 100), (i * 10, 50, 50)).save(src / "batch_1" / f"{i}.jpg")
        images.append({"id": i, "file_name": f"batch_1/{i}.jpg", "width": 200, "height": 100})
        anns.append({"id": i, "image_id": i, "category_id": 1 if i % 2 else 2, "bbox": [20, 10, 100, 50]})
    coco = {"images": images, "annotations": anns,
            "categories": [{"id": 1, "name": "Clear plastic bottle"}, {"id": 2, "name": "Drink can"}]}
    (src / "annotations.json").write_text(json.dumps(coco))
    stats = prepare.prep_taco(src, tmp_path / "work")
    assert stats == {"pet_bottle": 10, "aluminum_can": 10}
    lbl = next((tmp_path / "work" / "taco" / "labels").iterdir()).read_text().split()
    assert [float(x) for x in lbl[1:]] == [0.35, 0.35, 0.5, 0.5]  # (20+50)/200, (10+25)/100, 100/200, 50/100
    prepare.split(tmp_path / "work", tmp_path / "merged")
    rep = json.loads((tmp_path / "merged" / "split_report.json").read_text())
    assert (rep["train"], rep["val"], rep["test"]) == (16, 2, 2)
    data = yaml.safe_load((tmp_path / "merged" / "data.yaml").read_text())
    assert data["names"][0] == "pet_bottle" and len(data["names"]) == 13
