"""Shared parse entry used by HTTP and CLI."""

from __future__ import annotations

import base64
from urllib.error import URLError
from urllib.request import Request, urlopen

from plan_parser.contract import validate_patch
from plan_parser.models import OPENCV_NO_GEOMETRY, ParseRequest, ParseResult
from plan_parser.opencv import decode_plan_image, diagnostics_dict, extract_rooms

_FETCH_TIMEOUT_S = 15
_MAX_PLAN_BYTES = 12 * 1024 * 1024


def _plan_bytes(request: ParseRequest) -> bytes:
    if request.plan_base64 is not None:
        payload = request.plan_base64
        if payload.startswith("data:") and "," in payload:
            payload = payload.split(",", 1)[1]
        try:
            data = base64.b64decode(payload, validate=False)
        except Exception as exc:
            raise ValueError("planBase64 is not valid base64") from exc
        if not data:
            raise ValueError("planBase64 decoded to empty bytes")
        if len(data) > _MAX_PLAN_BYTES:
            raise ValueError("plan image exceeds size limit")
        return data

    url = request.plan_url
    if url is None:
        raise ValueError("exactly one of planUrl or planBase64 is required")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("planUrl must be http(s); pass planBase64 for a local file")
    try:
        with urlopen(Request(url, method="GET"), timeout=_FETCH_TIMEOUT_S) as response:
            data = response.read(_MAX_PLAN_BYTES + 1)
    except URLError as exc:
        raise ValueError(f"failed to fetch planUrl: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ValueError(f"planUrl fetch timed out after {_FETCH_TIMEOUT_S}s") from exc
    if len(data) > _MAX_PLAN_BYTES:
        raise ValueError("plan image exceeds size limit")
    if not data:
        raise ValueError("planUrl returned empty body")
    return data


def parse_plan(request: ParseRequest) -> ParseResult:
    """Run the OpenCV pass and return a geometry patch or an explicit empty result.

    This slice does not emit vertices/walls ops (task 2.1). A null patch with
    reason and diagnostics is the documented empty outcome, not an exception.
    """
    image_bytes = _plan_bytes(request)
    decoded = decode_plan_image(image_bytes)
    extracted = extract_rooms(decoded.image, area_declared=request.area_declared)
    diagnostics = diagnostics_dict(request.listing_id, extracted)
    result = ParseResult(patch=None, reason=OPENCV_NO_GEOMETRY, diagnostics=diagnostics)
    if result.patch is not None:
        errors = validate_patch(result.patch)
        if errors:
            raise ValueError("patch failed Contract JSON Schema: " + "; ".join(errors))
    return result
