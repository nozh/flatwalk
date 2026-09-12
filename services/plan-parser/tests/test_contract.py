from __future__ import annotations

from pathlib import Path

from plan_parser.contract import contract_schema_dir, schema_availability, validate_patch


def test_schema_dir_points_at_contract_module() -> None:
    path = contract_schema_dir()
    assert path.parts[-3:] == ("modules", "contract", "schemas")


def test_missing_patch_schema_is_reported() -> None:
    availability = schema_availability()
    generated = (Path(contract_schema_dir()) / "Patch.schema.json").is_file()
    assert availability["Patch"] is generated
    if not generated:
        errors = validate_patch({"ops": []})
        assert any("contract-schema-unavailable" in item for item in errors)


def test_schema_dir_override(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FLATWALK_CONTRACT_SCHEMAS", str(tmp_path))
    assert contract_schema_dir() == tmp_path
    assert schema_availability()["Patch"] is False
