from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

OPENCV_NO_GEOMETRY = "opencv-no-geometry"


class ParseRequest(BaseModel):
    """HTTP/CLI input for POST /parse. Field names match modules.md §5.2a."""

    model_config = ConfigDict(extra="forbid")

    listing_id: str = Field(min_length=1, alias="listingId")
    area_declared: float | None = Field(default=None, gt=0, alias="areaDeclared")
    plan_url: str | None = Field(default=None, alias="planUrl")
    plan_base64: str | None = Field(default=None, alias="planBase64")

    @field_validator("listing_id", "plan_url", "plan_base64")
    @classmethod
    def strip_nonempty(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("must be a non-empty string")
        return stripped

    @model_validator(mode="after")
    def exactly_one_plan_source(self) -> ParseRequest:
        has_url = self.plan_url is not None
        has_b64 = self.plan_base64 is not None
        if has_url == has_b64:
            raise ValueError("exactly one of planUrl or planBase64 is required")
        return self


class ParseResult(BaseModel):
    """Empty parser outcome is a contract value, not an HTTP/CLI exception."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    patch: dict[str, Any] | None
    reason: str | None = None
    diagnostics: dict[str, Any] | None = None

    @model_validator(mode="after")
    def patch_or_reason(self) -> ParseResult:
        if self.patch is None and not self.reason:
            raise ValueError("reason is required when patch is null")
        if self.patch is not None and self.reason is not None:
            raise ValueError("reason must be omitted when patch is present")
        return self
