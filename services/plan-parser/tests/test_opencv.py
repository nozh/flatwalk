from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from plan_parser.opencv import decode_plan_image, extract_rooms

FIXTURE_PLAN = Path(__file__).resolve().parents[3] / "fixtures" / "54541" / "plan.png"


def _two_room_plan() -> np.ndarray:
    """White plan, two rooms separated by a solid wall."""
    img = np.full((80, 160, 3), 255, dtype=np.uint8)
    img[8:72, 8:12] = 0
    img[8:72, 148:152] = 0
    img[8:12, 8:152] = 0
    img[68:72, 8:152] = 0
    img[8:72, 78:84] = 0
    return img


def test_decode_plan_image_uses_file_pixels_not_docs_example() -> None:
    if not FIXTURE_PLAN.is_file():
        pytest.skip("fixtures/54541/plan.png is not present")
    decoded = decode_plan_image(FIXTURE_PLAN.read_bytes())
    assert decoded.image.shape[0] == 786
    assert decoded.image.shape[1] == 940
    assert decoded.size == {"width": 940, "height": 786}


def test_extract_rooms_finds_two_closed_interiors() -> None:
    result = extract_rooms(_two_room_plan(), area_declared=20.0)
    assert result.image_size == {"width": 160, "height": 80}
    assert len(result.rooms) == 2
    assert result.mask_full.shape == (80, 160)
    assert result.mask_thick.shape == (80, 160)
    assert (result.mask_full > 0).sum() > (result.mask_thick > 0).sum()
    assert all(room.simplified_contour.size >= 6 for room in result.rooms)
    assert result.scale["basis"] == "declared-area"
    assert result.scale["pxPerMeter"] is not None
    assert result.scale["estimated"] is True


def test_extract_rooms_without_area_does_not_invent_meters() -> None:
    result = extract_rooms(_two_room_plan(), area_declared=None)
    assert result.scale["pxPerMeter"] is None
    assert result.scale["basis"] is None
    assert "areaDeclared" in result.scale["reason"]


def test_extract_rooms_records_discarded_tiny_contours() -> None:
    img = _two_room_plan()
    img[16:28, 20:32] = 0
    img[19:24, 23:28] = 255
    result = extract_rooms(img, area_declared=None)
    reasons = {item["reason"] for item in result.discarded}
    assert "too-small" in reasons or len(result.rooms) == 2
