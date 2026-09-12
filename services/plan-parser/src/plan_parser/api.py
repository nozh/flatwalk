from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from plan_parser.contract import schema_availability
from plan_parser.models import ParseRequest, ParseResult
from plan_parser.parse import parse_plan

app = FastAPI(title="FlatWalk Plan Parser", version="0.1.0")


class HealthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    status: Literal["ok"]
    contract_schemas: dict[str, bool] = Field(alias="contractSchemas")


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok", contractSchemas=schema_availability())


@app.post("/parse")
def parse(request: ParseRequest) -> ParseResult:
    try:
        return parse_plan(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
