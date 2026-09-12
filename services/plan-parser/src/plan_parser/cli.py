from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from plan_parser.models import OPENCV_NO_GEOMETRY, ParseRequest, ParseResult
from plan_parser.opencv import (
    decode_plan_image,
    diagnostics_dict,
    extract_rooms,
    write_debug_artifacts,
)
from plan_parser.parse import parse_plan


def _add_plan_args(cmd: argparse.ArgumentParser) -> None:
    cmd.add_argument("plan", type=Path, help="path to plan.png")
    cmd.add_argument("--listing-id", required=True, dest="listing_id")
    cmd.add_argument("--area", type=float, default=None, dest="area")
    cmd.add_argument(
        "--out",
        type=Path,
        default=None,
        help="directory for result.json (and debug images for the debug command)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="plan_parser")
    sub = parser.add_subparsers(dest="command", required=True)
    parse_cmd = sub.add_parser("parse", help="parse a floor-plan image (same code as HTTP /parse)")
    _add_plan_args(parse_cmd)
    debug_cmd = sub.add_parser(
        "debug",
        help="OpenCV masks and room candidates; still returns patch:null",
    )
    debug_cmd.add_argument("plan", type=Path, help="path to plan.png")
    debug_cmd.add_argument("--listing-id", required=True, dest="listing_id")
    debug_cmd.add_argument("--area", type=float, default=None, dest="area")
    debug_cmd.add_argument(
        "--out",
        type=Path,
        required=True,
        help="directory for masks, diagnostics.json, and result.json",
    )
    return parser


def request_from_plan_file(plan: Path, listing_id: str, area: float | None) -> ParseRequest:
    if not plan.is_file():
        raise FileNotFoundError(f"plan file not found: {plan}")
    encoded = base64.b64encode(plan.read_bytes()).decode("ascii")
    payload: dict[str, object] = {"listingId": listing_id, "planBase64": encoded}
    if area is not None:
        payload["areaDeclared"] = area
    return ParseRequest.model_validate(payload)


def emit_result(result: ParseResult, out_dir: Path | None) -> None:
    payload = result.model_dump(by_alias=True)
    text = json.dumps(payload, indent=2) + "\n"
    sys.stdout.write(text)
    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "result.json").write_text(text, encoding="utf-8")
        if result.diagnostics is not None:
            (out_dir / "diagnostics.json").write_text(
                json.dumps(result.diagnostics, indent=2) + "\n",
                encoding="utf-8",
            )


def run_debug(plan: Path, listing_id: str, area: float | None, out_dir: Path | None) -> ParseResult:
    if not plan.is_file():
        raise FileNotFoundError(f"plan file not found: {plan}")
    decoded = decode_plan_image(plan.read_bytes())
    extracted = extract_rooms(decoded.image, area_declared=area)
    if out_dir is None:
        raise ValueError("debug requires --out directory for masks and diagnostics.json")
    write_debug_artifacts(out_dir, listing_id, extracted)
    return ParseResult(
        patch=None,
        reason=OPENCV_NO_GEOMETRY,
        diagnostics=diagnostics_dict(listing_id, extracted),
    )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "parse":
            request = request_from_plan_file(args.plan, args.listing_id, args.area)
            result = parse_plan(request)
        elif args.command == "debug":
            result = run_debug(args.plan, args.listing_id, args.area, args.out)
        else:
            parser.error(f"unknown command {args.command}")
    except (OSError, ValidationError, ValueError) as exc:
        sys.stderr.write(f"{exc}\n")
        return 2
    emit_result(result, args.out)
    return 0
