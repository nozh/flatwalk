from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

from plan_parser.models import OPENCV_NO_GEOMETRY

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


def test_debug_command_writes_masks_and_diagnostics(tmp_path: Path) -> None:
    plan = tmp_path / "plan.png"
    _write_two_room_png(plan)
    out = tmp_path / "parser"
    completed = _run_module(
        "debug",
        str(plan),
        "--listing-id",
        "synthetic",
        "--area",
        "20",
        "--out",
        str(out),
    )
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["patch"] is None
    assert payload["reason"] == OPENCV_NO_GEOMETRY
    assert payload["diagnostics"]["rooms"]["count"] == 2
    expected = [
        "source.png",
        "mask-full.png",
        "mask-thick.png",
        "rooms.png",
        "debug-masks.png",
        "diagnostics.json",
        "result.json",
    ]
    for name in expected:
        assert (out / name).is_file(), name
    diagnostics = json.loads((out / "diagnostics.json").read_text(encoding="utf-8"))
    assert diagnostics["imageSize"] == {"width": 160, "height": 80}
    assert diagnostics["rooms"]["count"] == 2
    assert "parameters" in diagnostics
    assert (out / "result.json").read_text(encoding="utf-8")
    written = json.loads((out / "result.json").read_text(encoding="utf-8"))
    assert written == payload


def test_debug_rejects_unreadable_image(tmp_path: Path) -> None:
    plan = tmp_path / "plan.png"
    plan.write_bytes(b"not-a-png")
    completed = _run_module(
        "debug",
        str(plan),
        "--listing-id",
        "x",
        "--out",
        str(tmp_path / "out"),
    )
    assert completed.returncode == 2
    assert "decode" in completed.stderr.lower() or "image" in completed.stderr.lower()


def test_parse_54541_runs_opencv_without_seeding_etalon() -> None:
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
    assert payload["diagnostics"]["rooms"]["count"] == 7
    assert payload["diagnostics"]["geometrySuitable"] is False
