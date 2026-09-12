from __future__ import annotations

import base64
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from plan_parser.api import app
from plan_parser.models import OPENCV_NO_GEOMETRY, ParseRequest
from plan_parser.parse import parse_plan

client = TestClient(app)

FIXTURE_PLAN = Path(__file__).resolve().parents[3] / "fixtures" / "54541" / "plan.png"


def _two_room_png_b64() -> str:
    img = np.full((80, 160, 3), 255, dtype=np.uint8)
    img[8:72, 8:12] = 0
    img[8:72, 148:152] = 0
    img[8:12, 8:152] = 0
    img[68:72, 8:152] = 0
    img[8:72, 78:84] = 0
    ok, encoded = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def test_health_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert set(body["contractSchemas"]) >= {"Patch", "FlatModel"}


def test_parse_returns_opencv_diagnostics_not_a_patch() -> None:
    body = {
        "listingId": "synthetic",
        "areaDeclared": 20,
        "planBase64": _two_room_png_b64(),
    }
    response = client.post("/parse", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["patch"] is None
    assert payload["reason"] == OPENCV_NO_GEOMETRY
    assert payload["diagnostics"]["rooms"]["count"] == 2
    assert payload["diagnostics"]["geometrySuitable"] is False
    assert payload["diagnostics"]["imageSize"] == {"width": 160, "height": 80}


def test_parse_rejects_undecodable_plan() -> None:
    response = client.post(
        "/parse",
        json={"listingId": "54541", "areaDeclared": 105, "planBase64": "aGVsbG8="},
    )
    assert response.status_code == 422
    assert "decode" in str(response.json()).lower() or "image" in str(response.json()).lower()


def test_parse_rejects_missing_plan_source() -> None:
    response = client.post("/parse", json={"listingId": "54541", "areaDeclared": 105})
    assert response.status_code == 422


def test_parse_rejects_both_plan_sources() -> None:
    response = client.post(
        "/parse",
        json={
            "listingId": "54541",
            "planUrl": "https://example.invalid/plan.png",
            "planBase64": "aGVsbG8=",
        },
    )
    assert response.status_code == 422


def test_parse_rejects_empty_listing_id() -> None:
    response = client.post(
        "/parse",
        json={"listingId": "  ", "planBase64": "aGVsbG8="},
    )
    assert response.status_code == 422


def test_parse_rejects_non_positive_area() -> None:
    response = client.post(
        "/parse",
        json={"listingId": "54541", "areaDeclared": 0, "planBase64": "aGVsbG8="},
    )
    assert response.status_code == 422


def test_http_matches_shared_parse_plan() -> None:
    body = {
        "listingId": "synthetic",
        "areaDeclared": 20,
        "planBase64": _two_room_png_b64(),
    }
    request = ParseRequest.model_validate(body)
    shared = parse_plan(request).model_dump(by_alias=True)
    http = client.post("/parse", json=body).json()
    assert http == shared


def test_parse_54541_runs_opencv_on_source_plan() -> None:
    if not FIXTURE_PLAN.is_file():
        return
    encoded = base64.b64encode(FIXTURE_PLAN.read_bytes()).decode("ascii")
    response = client.post(
        "/parse",
        json={"listingId": "54541", "areaDeclared": 105, "planBase64": encoded},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["patch"] is None
    assert payload["reason"] == OPENCV_NO_GEOMETRY
    diagnostics = payload["diagnostics"]
    assert diagnostics["listingId"] == "54541"
    assert diagnostics["imageSize"] == {"width": 940, "height": 786}
    assert diagnostics["rooms"]["count"] == 7
    assert diagnostics["scale"]["basis"] == "declared-area"
    assert diagnostics["geometrySuitable"] is False
    assert "flat.model.json" in diagnostics["note"]
