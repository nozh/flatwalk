from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from plan_parser.cli import main
from plan_parser.models import OPENCV_NO_GEOMETRY, ParseRequest
from plan_parser.parse import parse_plan

REPO_SRC = Path(__file__).resolve().parents[1] / "src"
FIXTURE_PLAN = Path(__file__).resolve().parents[3] / "fixtures" / "54541" / "plan.png"


def _run_module(*args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(REPO_SRC) if not existing else f"{REPO_SRC}{os.pathsep}{existing}"
    return subprocess.run(
        [sys.executable, "-m", "plan_parser", *args],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(REPO_SRC.parent),
        check=False,
    )


def _write_two_room_png(path: Path) -> None:
    img = np.full((80, 160, 3), 255, dtype=np.uint8)
    img[8:72, 8:12] = 0
    img[8:72, 148:152] = 0
    img[8:12, 8:152] = 0
    img[68:72, 8:152] = 0
    img[8:72, 78:84] = 0
    cv2.imwrite(str(path), img)


def test_cli_parse_stdout_matches_shared_code(tmp_path: Path) -> None:
    plan = tmp_path / "plan.png"
    _write_two_room_png(plan)
    completed = _run_module(
        "parse",
        str(plan),
        "--listing-id",
        "synthetic",
        "--area",
        "20",
    )
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["patch"] is None
    assert payload["reason"] == OPENCV_NO_GEOMETRY
    assert payload["diagnostics"]["rooms"]["count"] == 2
    request = ParseRequest.model_validate(
        {
            "listingId": "synthetic",
            "areaDeclared": 20,
            "planBase64": __import__("base64").b64encode(plan.read_bytes()).decode("ascii"),
        }
    )
    shared = parse_plan(request).model_dump(by_alias=True)
    assert shared == payload


def test_cli_writes_out_dir(tmp_path: Path) -> None:
    plan = tmp_path / "plan.png"
    _write_two_room_png(plan)
    out = tmp_path / "parser"
    completed = _run_module(
        "parse",
        str(plan),
        "--listing-id",
        "synthetic",
        "--out",
        str(out),
    )
    assert completed.returncode == 0, completed.stderr
    written = json.loads((out / "result.json").read_text(encoding="utf-8"))
    assert written == json.loads(completed.stdout)
    assert written["reason"] == OPENCV_NO_GEOMETRY
    diagnostics = json.loads((out / "diagnostics.json").read_text(encoding="utf-8"))
    assert diagnostics["rooms"]["count"] == 2


def test_cli_rejects_missing_plan(tmp_path: Path) -> None:
    missing = tmp_path / "nope.png"
    completed = _run_module("parse", str(missing), "--listing-id", "54541")
    assert completed.returncode == 2
    assert "not found" in completed.stderr.lower() or "nope.png" in completed.stderr


def test_cli_rejects_undecodable_plan(tmp_path: Path) -> None:
    plan = tmp_path / "plan.png"
    plan.write_bytes(b"not-a-real-png")
    completed = _run_module("parse", str(plan), "--listing-id", "54541")
    assert completed.returncode == 2
    assert "decode" in completed.stderr.lower() or "image" in completed.stderr.lower()


def test_cli_rejects_missing_listing_id(tmp_path: Path) -> None:
    plan = tmp_path / "plan.png"
    _write_two_room_png(plan)
    completed = _run_module("parse", str(plan))
    assert completed.returncode != 0


def test_cli_rejects_non_positive_area(tmp_path: Path) -> None:
    plan = tmp_path / "plan.png"
    _write_two_room_png(plan)
    completed = _run_module("parse", str(plan), "--listing-id", "54541", "--area", "0")
    assert completed.returncode == 2
    assert completed.stderr.strip()


def test_main_returns_zero(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = tmp_path / "plan.png"
    _write_two_room_png(plan)
    code = main(["parse", str(plan), "--listing-id", "x"])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["patch"] is None
    assert payload["reason"] == OPENCV_NO_GEOMETRY


def test_cli_parse_54541_is_diagnostics_not_etalon() -> None:
    if not FIXTURE_PLAN.is_file():
        return
    completed = _run_module(
        "parse",
        str(FIXTURE_PLAN),
        "--listing-id",
        "54541",
        "--area",
        "105",
    )
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["patch"] is None
    assert payload["reason"] == OPENCV_NO_GEOMETRY
    assert payload["diagnostics"]["imageSize"] == {"width": 940, "height": 786}
    assert payload["diagnostics"]["rooms"]["count"] == 7
    assert payload["diagnostics"]["geometrySuitable"] is False
