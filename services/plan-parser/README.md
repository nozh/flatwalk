# Plan Parser

Python-сервис этапа `parse`: FastAPI и CLI вызывают одну функцию `parse_plan`.
Этот срез гоняет OpenCV по исходному PNG и возвращает диагностику комнат.
Геометрический патч вершин/стен **ещё не выдаётся** (не эталон `flat.model.json`).

```json
{"patch": null, "reason": "opencv-no-geometry", "diagnostics": { "...": "room candidates" }}
```

Пустой патч — контрактный исход (modules.md §5.2a), не исключение. `geometrySuitable: false`.

Команда `debug` пишет маски и `diagnostics.json`. Временные номера на `rooms.png`
не являются ID модели.

## Зависимость от Contract

Pydantic-схема **FlatModel здесь не определяется**. JSON Schema общего контракта
ожидается в `modules/contract/schemas/` (генерация:
`npm run schema:generate -w @flatwalk/contract`). Каталог можно переопределить
`FLATWALK_CONTRACT_SCHEMAS`. `GET /health` сообщает `contractSchemas.Patch`.
Непустой патч будет проверяться по `Patch.schema.json`, когда он появится.

## Локально

Из `code/flatwalk-repo/services/plan-parser`:

```sh
uv sync --frozen
uv run uvicorn plan_parser.api:app --host 127.0.0.1 --port 8000
```

Проверка `/health` и `/parse` на исходном плане 54541 (940×786, не эталонная геометрия):

```sh
curl -s http://127.0.0.1:8000/health
python3 - <<'PY'
import base64, json, urllib.request
from pathlib import Path
plan = Path("../../fixtures/54541/plan.png").read_bytes()
body = json.dumps({
  "listingId": "54541",
  "areaDeclared": 105,
  "planBase64": base64.b64encode(plan).decode("ascii"),
}).encode()
req = urllib.request.Request(
  "http://127.0.0.1:8000/parse",
  data=body,
  headers={"content-type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
PY
```

Ожидание: HTTP 200, `patch: null`, `reason: opencv-no-geometry`, 7 кандидатов комнат,
`imageSize` 940×786. Это **не** пригодный граф стен.

CLI (тот же код, что HTTP):

```sh
uv run python -m plan_parser parse \
  ../../fixtures/54541/plan.png \
  --listing-id 54541 \
  --area 105 \
  --out out/54541-parse
```

Отладочные маски:

```sh
uv run python -m plan_parser debug \
  ../../fixtures/54541/plan.png \
  --listing-id 54541 \
  --area 105 \
  --out out/54541
```

Ровно один источник плана: `planUrl` **или** `planBase64` (в CLI файл кодируется
как `planBase64`). Неверный вход или нечитаемое изображение: HTTP 422, CLI код 2.

`planUrl` скачивается только по http(s); локальный файл передавайте как `planBase64`.

## Проверки

```sh
uv sync --frozen
uv run pytest
uv run ruff check src tests
```

## Контейнер

```sh
docker build -t flatwalk-plan-parser .
docker run --rm -p 8000:8000 -e PORT=8000 flatwalk-plan-parser
```

На Render: Web Service, runtime из этого Dockerfile, `healthCheckPath: /health`,
uvicorn на `$PORT`.
