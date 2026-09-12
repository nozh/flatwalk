"""OpenCV pass for floor-plan masks and room candidates (task 1.8).

Tuned for listing 54541 (940×786 RGBA with navy fill). Not a universal parser.
Does not emit a FlatModel geometry patch.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# 54541: after compositing onto white, walls and door/window ticks are < 200;
# room fill is ~238; watermark ~241. Opening 5 px drops thin opening strokes.
DEFAULT_PARAMETERS: dict[str, Any] = {
    "darkThreshold": 200,
    "thickOpenKernel": 5,
    "connectivity": 4,
    "minAreaPx": 2500,
    "maxAreaFrac": 0.45,
    "rejectBorder": True,
    "fillAlphaLow": 10,
    "fillAlphaHigh": 30,
    "minFillFraction": 0.5,
    "fillFilterMinCoverage": 0.05,
    "approxEpsilonFrac": 0.006,
}


@dataclass
class DecodedPlan:
    image: np.ndarray
    size: dict[str, int]
    channels: int


@dataclass
class RoomCandidate:
    diagnostic_id: int
    area_px: int
    centroid: tuple[float, float]
    bbox: tuple[int, int, int, int]
    contour: np.ndarray
    simplified_contour: np.ndarray
    fill_fraction: float
    mean_gray: float


@dataclass
class ExtractResult:
    image_size: dict[str, int]
    composite: np.ndarray
    mask_full: np.ndarray
    mask_thick: np.ndarray
    rooms: list[RoomCandidate]
    discarded: list[dict[str, Any]]
    parameters: dict[str, Any]
    scale: dict[str, Any]
    limitations: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def decode_plan_image(data: bytes) -> DecodedPlan:
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError("could not decode plan image")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    height, width = image.shape[:2]
    channels = 1 if image.ndim == 2 else image.shape[2]
    return DecodedPlan(
        image=image,
        size={"width": int(width), "height": int(height)},
        channels=channels,
    )


def _composite_on_white(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if image.shape[2] == 4:
        bgr = image[:, :, :3].astype(np.float32)
        alpha = image[:, :, 3]
        alpha_f = alpha.astype(np.float32) / 255.0
        composite = bgr * alpha_f[..., None] + 255.0 * (1.0 - alpha_f[..., None])
        return composite.astype(np.uint8), alpha
    if image.shape[2] == 3:
        return image.copy(), np.full(image.shape[:2], 255, dtype=np.uint8)
    raise ValueError(f"unsupported image shape {image.shape}")


def extract_rooms(
    image: np.ndarray,
    area_declared: float | None = None,
    parameters: dict[str, Any] | None = None,
) -> ExtractResult:
    params = {**DEFAULT_PARAMETERS, **(parameters or {})}
    composite, alpha = _composite_on_white(image)
    gray = cv2.cvtColor(composite, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape
    image_size = {"width": int(width), "height": int(height)}

    mask_full = (gray < int(params["darkThreshold"])).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (int(params["thickOpenKernel"]), int(params["thickOpenKernel"]))
    )
    mask_thick = cv2.morphologyEx(mask_full, cv2.MORPH_OPEN, kernel)

    interior = cv2.bitwise_not(mask_full)
    n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        interior, connectivity=int(params["connectivity"])
    )

    navy = (alpha >= int(params["fillAlphaLow"])) & (alpha <= int(params["fillAlphaHigh"]))
    use_fill_filter = float(navy.mean()) >= float(params["fillFilterMinCoverage"])

    discarded: list[dict[str, Any]] = []
    accepted: list[dict[str, Any]] = []
    max_area = float(params["maxAreaFrac"]) * width * height
    min_area = int(params["minAreaPx"])

    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        x, y, bw, bh = (int(v) for v in stats[label, :4])
        component = labels == label
        ys, xs = np.where(component)
        touches_border = bool(
            (xs == 0).any()
            or (ys == 0).any()
            or (xs == width - 1).any()
            or (ys == height - 1).any()
        )
        fill_fraction = float(navy[component].mean()) if component.any() else 0.0
        mean_gray = float(gray[component].mean()) if component.any() else 0.0
        reason: str | None = None
        if area < min_area:
            reason = "too-small"
        elif area > max_area:
            reason = "too-large"
        elif params["rejectBorder"] and touches_border:
            reason = "touches-border"
        elif use_fill_filter and fill_fraction < float(params["minFillFraction"]):
            reason = "low-fill-fraction"
        record = {
            "areaPx": area,
            "bbox": [x, y, bw, bh],
            "centroid": [float(centroids[label][0]), float(centroids[label][1])],
            "fillFraction": round(fill_fraction, 4),
            "meanGray": round(mean_gray, 2),
            "touchesBorder": touches_border,
        }
        if reason:
            discarded.append({**record, "reason": reason})
            continue
        mask = component.astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            discarded.append({**record, "reason": "no-contour"})
            continue
        contour = max(contours, key=cv2.contourArea)
        peri = cv2.arcLength(contour, True)
        epsilon = max(1.0, float(params["approxEpsilonFrac"]) * peri)
        simplified = cv2.approxPolyDP(contour, epsilon, True)
        accepted.append(
            {
                **record,
                "contour": contour,
                "simplified": simplified,
            }
        )

    accepted.sort(key=lambda item: (item["centroid"][1], item["centroid"][0]))
    rooms: list[RoomCandidate] = []
    for index, item in enumerate(accepted):
        rooms.append(
            RoomCandidate(
                diagnostic_id=index,
                area_px=item["areaPx"],
                centroid=(item["centroid"][0], item["centroid"][1]),
                bbox=(item["bbox"][0], item["bbox"][1], item["bbox"][2], item["bbox"][3]),
                contour=item["contour"],
                simplified_contour=item["simplified"],
                fill_fraction=item["fillFraction"],
                mean_gray=item["meanGray"],
            )
        )

    limitations: list[str] = []
    notes: list[str] = []
    if use_fill_filter:
        notes.append(
            "fill-fraction filter is on because the plan has a semi-transparent navy fill "
            "(54541-style). Candidates with little fill are likely terrace, furniture, or ticks."
        )
        terrace_like = [d for d in discarded if d["reason"] == "low-fill-fraction"]
        if terrace_like:
            notes.append(
                "low-fill-fraction discards include a likely terrace / unfilled exterior pocket; "
                "this is a heuristic, not a geometric terrace classifier."
            )
        else:
            limitations.append(
                "terrace exclusion is not confirmed: no low-fill-fraction candidate was discarded."
            )
    else:
        limitations.append(
            "navy-fill filter off (little alpha-17 fill); terrace is not excluded by fill."
        )

    open_plan = [room for room in rooms if room.area_px > 0.15 * width * height]
    if open_plan:
        limitations.append(
            "at least one candidate is a merged open-plan blob (kitchen/dining/living on 54541 "
            "share openings without door strokes). Temporary numbers are not model IDs."
        )

    scale = _scale_from_rooms(rooms, area_declared, limitations)

    return ExtractResult(
        image_size=image_size,
        composite=composite,
        mask_full=mask_full,
        mask_thick=mask_thick,
        rooms=rooms,
        discarded=discarded,
        parameters=params,
        scale=scale,
        limitations=limitations,
        notes=notes,
    )


def _scale_from_rooms(
    rooms: list[RoomCandidate],
    area_declared: float | None,
    limitations: list[str],
) -> dict[str, Any]:
    area_px = int(sum(room.area_px for room in rooms))
    scale: dict[str, Any] = {
        "areaPxSum": area_px,
        "areaDeclaredSqm": area_declared,
        "pxPerMeter": None,
        "basis": None,
        "estimated": False,
        "reason": None,
    }
    if area_declared is None:
        scale["reason"] = "areaDeclared is missing; pixels are not meters"
        return scale
    if area_px <= 0:
        scale["reason"] = "no room candidates; cannot estimate pxPerMeter"
        limitations.append("scale skipped: zero accepted room area")
        return scale
    px_per_meter = float(np.sqrt(area_px / float(area_declared)))
    scale.update(
        {
            "pxPerMeter": round(px_per_meter, 4),
            "basis": "declared-area",
            "estimated": True,
            "reason": (
                "pxPerMeter = sqrt(sum(room area px) / areaDeclared). "
                "Estimate only; vectorization and open-plan merge bias it."
            ),
        }
    )
    return scale


def render_rooms_overlay(composite: np.ndarray, rooms: list[RoomCandidate]) -> np.ndarray:
    vis = composite.copy()
    rng = np.random.default_rng(7)
    for room in rooms:
        color = tuple(int(c) for c in rng.integers(30, 220, 3))
        mask = np.zeros(composite.shape[:2], dtype=np.uint8)
        cv2.drawContours(mask, [room.contour], -1, 255, thickness=cv2.FILLED)
        overlay = vis.copy()
        overlay[mask > 0] = color
        vis = cv2.addWeighted(overlay, 0.38, vis, 0.62, 0)
        cv2.drawContours(vis, [room.contour], -1, (40, 160, 40), 1)
        cv2.drawContours(vis, [room.simplified_contour], -1, (0, 0, 255), 2)
        cx, cy = int(room.centroid[0]), int(room.centroid[1])
        cv2.putText(
            vis,
            str(room.diagnostic_id),
            (cx - 10, cy + 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 0, 255),
            2,
            cv2.LINE_AA,
        )
    return vis


def render_debug_montage(
    source: np.ndarray,
    mask_full: np.ndarray,
    mask_thick: np.ndarray,
    rooms_overlay: np.ndarray,
) -> np.ndarray:
    full_bgr = cv2.cvtColor(mask_full, cv2.COLOR_GRAY2BGR)
    thick_bgr = cv2.cvtColor(mask_thick, cv2.COLOR_GRAY2BGR)
    labeled = []
    for img, title in (
        (source, "source"),
        (full_bgr, "mask-full"),
        (thick_bgr, "mask-thick"),
        (rooms_overlay, "rooms"),
    ):
        frame = img.copy()
        cv2.putText(frame, title, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 80, 255), 2)
        labeled.append(frame)
    top = np.hstack(labeled[:2])
    bottom = np.hstack(labeled[2:])
    return np.vstack((top, bottom))


def diagnostics_dict(
    listing_id: str,
    result: ExtractResult,
) -> dict[str, Any]:
    return {
        "listingId": listing_id,
        "imageSize": result.image_size,
        "parameters": result.parameters,
        "scale": result.scale,
        "rooms": {
            "count": len(result.rooms),
            "candidates": [
                {
                    "diagnosticId": room.diagnostic_id,
                    "areaPx": room.area_px,
                    "centroid": [round(room.centroid[0], 2), round(room.centroid[1], 2)],
                    "bbox": list(room.bbox),
                    "verticesRaw": int(len(room.contour)),
                    "verticesSimplified": int(len(room.simplified_contour)),
                    "fillFraction": room.fill_fraction,
                    "meanGray": room.mean_gray,
                    "note": "temporary diagnostic number, not a FlatModel id",
                }
                for room in result.rooms
            ],
        },
        "discarded": result.discarded,
        "maskStats": {
            "fullPx": int((result.mask_full > 0).sum()),
            "thickPx": int((result.mask_thick > 0).sum()),
            "thinPx": int((result.mask_full > result.mask_thick).sum()),
        },
        "limitations": result.limitations,
        "notes": result.notes,
        "strategy": "opencv",
        "patch": None,
        "patchReason": "opencv-no-geometry",
        "geometrySuitable": False,
        "note": (
            "OpenCV produced room-candidate diagnostics, not Contract vertices/walls ops. "
            "This is not a substitute for fixtures/54541/flat.model.json."
        ),
    }


def write_debug_artifacts(
    out_dir: str | Path,
    listing_id: str,
    result: ExtractResult,
) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rooms_overlay = render_rooms_overlay(result.composite, result.rooms)
    montage = render_debug_montage(
        result.composite, result.mask_full, result.mask_thick, rooms_overlay
    )
    cv2.imwrite(str(out / "source.png"), result.composite)
    cv2.imwrite(str(out / "mask-full.png"), result.mask_full)
    cv2.imwrite(str(out / "mask-thick.png"), result.mask_thick)
    cv2.imwrite(str(out / "rooms.png"), rooms_overlay)
    cv2.imwrite(str(out / "debug-masks.png"), montage)
    (out / "diagnostics.json").write_text(
        json.dumps(diagnostics_dict(listing_id, result), indent=2) + "\n",
        encoding="utf-8",
    )
