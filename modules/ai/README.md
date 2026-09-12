# @flatwalk/ai — адаптеры Grok и fal

Каркас задачи 0.8: изолированные клиенты x.ai (Grok vision) и fal Hunyuan World image-to-panorama. Бизнес-логика Photo Matcher / Dresser, бюджет задания и FlatModel здесь не живут.

## Режимы

`FLATWALK_ADAPTERS` (deploy.md §6):

| Значение | Поведение |
|---|---|
| unset / `fixture` | читает JSON из `fixtures/`; сеть не вызывается |
| `live` | только явно; ключи `XAI_API_KEY` и `FAL_KEY` |

Отсутствующий файл фикстуры — ошибка `missing-fixture`, не переход в live.

## Локальный запуск

Из `code/flatwalk-repo`:

```text
npm ci --ignore-scripts
npm test -w @flatwalk/ai
```

Корневой `npm test` также запускает `@flatwalk/ai` после `@flatwalk/firecrawl`.

или из пакета, тем же vitest репозитория:

```text
cd modules/ai
npx vitest run --config vitest.config.ts
```

Живой вызов (платный, вручную):

```text
cp modules/ai/.env.example .env   # значения не коммитить
# заполнить XAI_API_KEY и/или FAL_KEY
export FLATWALK_ADAPTERS=live
```

Вызов через библиотеку, не через скрытый fallback:

```ts
import { createGrokClient, createFalClient } from "@flatwalk/ai";

const grok = createGrokClient({ mode: "live" }); // требует XAI_API_KEY
const fal = createFalClient({ mode: "live" });   // требует FAL_KEY
```

Транспорт подменяется (`HttpTransport`) в тестах. Это не живой API.

## Провайдеры (документация на момент реализации)

- Grok: `POST https://api.x.ai/v1/chat/completions`, `Authorization: Bearer $XAI_API_KEY`, модель по умолчанию `grok-4.6`. Картинки — `content[]` с `type: image_url` (REST chat completions).
- fal panorama: endpoint id **`fal-ai/hunyuan_world`** (страница API: Image To Panorama). Очередь `https://queue.fal.run/fal-ai/hunyuan_world`, `Authorization: Key $FAL_KEY`. Не `image-to-world` (это другой endpoint, L3).

Синтетические JSON в `fixtures/` помечены `"synthetic": true`.

## grok-rects (задача 2.4)

Запасная стратегия Plan Parser: исходный план → JSON прямоугольников → патч общего графа. Живёт рядом с адаптером Grok, не в Python OpenCV и не в Orchestrator.

```ts
import { apply } from "@flatwalk/resolver";
import { createGrokClient } from "@flatwalk/ai";
import { runGrokRects, GROK_RECTS_FALLBACK_WHEN } from "@flatwalk/ai/grok-rects";

const grok = createGrokClient({ mode: "fixture" }); // live только явно
const { patch, reason, diagnostics } = await runGrokRects({
  model: rev0, // обязателен; скрытого состояния нет
  plan: { imageUrl: "https://…" },
  grok,
});
if (patch) {
  const next = apply(rev0, patch, {
    schemaVersion: "0.1",
    modelId: rev0.id,
    baseRevision: rev0.revision,
    currentRevision: rev0.revision,
    changes: [],
  });
}
```

Включать fallback, когда выполняется любое из `GROK_RECTS_FALLBACK_WHEN`: пустой `patch` OpenCV, таймаут 60 с, ошибки слоя «Геометрия» после ремонта, нет `PARSER_URL`. Маршрутизацию Orchestrator этот пакет не меняет.

Режим `fixture` читает `fixtures/grok/grok-rects.synthetic.json`. Нет файла — `missing-fixture`, сеть не вызывается.

Промпт: `plan-parser/grok-rects-prompt@0.1`. Модель провайдера по умолчанию `grok-4.6`. Diagnostics отличает `liveApiCalled` / `httpStatus` от `geometrySuitable`.

Проверка передачи исходного плана 54541 (пустая rev 0, без `flat.model.json`):

```text
# fixture — сеть не вызывается; synthetic JSON не является распознаванием 54541
node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts

# live диагностика: GET /v1/language-models (не generation) + один крошечный vision-запрос
FLATWALK_ADAPTERS=live node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts --diagnose

# live исходный план 54541; без XAI_API_KEY это missing-config, не fixture
FLATWALK_ADAPTERS=live node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts
```

Orchestrator/`tools/cli` этот срез не меняет.

## photo-matcher (задача 3.2)

Один вызов Grok vision: overlay принятой ревизии + фото → патч `assets.<id>.room/faces/look/meta`. Overlay передаётся явным входом (`renderOverlay` из `@flatwalk/builder/node` в Node); этот пакет его не рисует.

```ts
import { apply } from "@flatwalk/resolver";
import { createGrokClient } from "@flatwalk/ai";
import { runPhotoMatcher } from "@flatwalk/ai/photo-matcher";

const grok = createGrokClient({ mode: "fixture" });
const { patch, diagnostics } = await runPhotoMatcher({
  model: accepted, // обязателен
  overlay: { imageUrl: "parser/overlay-rev-003.png" },
  photos: [{ assetId: "p3", imageUrl: "materials/p3.jpg" }],
  grok,
});
if (patch) apply(accepted, patch, { schemaVersion: "0.1", modelId: accepted.id, baseRevision: accepted.revision, currentRevision: accepted.revision, changes: [] });
```

Режим `fixture` по умолчанию читает `fixtures/grok/photo-matcher.synthetic.json`. Для listing 54541 используйте `fixtureId: PHOTO_MATCHER_54541_FIXTURE_ID` (`fixtures/grok/photo-matcher.54541.json`, `synthetic: true`, ID ручной модели). Живой сохранённый ответ: `fixtures/grok/photo-matcher.54541.live.json` (`synthetic: false`). Чужие ID и стена не с контура комнаты отбрасываются в `diagnostics.dropped`. `roomId: null` даёт два `set: null` на room/faces. Защиту `human` делает Resolver.

Вызов Matcher передаёт **свои** `PHOTO_MATCHER_CHAT_EXTRA` (`reasoning_effort: low`, `max_completion_tokens: 8192`, `response_format.json_object`) и `timeoutMs: PHOTO_MATCHER_LIVE_TIMEOUT_MS` (180 с) в существующий `createGrokClient`. Это не общие defaults клиента (`DEFAULT_GROK_TIMEOUT_MS` = 120 с) и не `GROK_RECTS_CHAT_EXTRA` Parser. Отсутствующие usage/cost в diagnostics — `"unknown"`, не ноль. Live 54541 (17 JPEG + aligned overlay) завершился HTTP completion за ~32 с; см. `docs/modules/photo-matcher.md`.

Проба (ручная геометрия 54541, не распознавание):

```text
# fixture — сеть не вызывается
node --import tsx modules/ai/scripts/probe-photo-matcher-54541.ts

# live только явно; один bounded вызов; без XAI_API_KEY это missing-config
FLATWALK_ADAPTERS=live node --import tsx modules/ai/scripts/probe-photo-matcher-54541.ts
```

## dresser L1 (задача 3.3)

Детерминированная отделка по текущим `assets.*.room` и `look.floor`. Сети и повторного распознавания фото нет. Патч только `rooms.<id>.dressing` (`module: dresser@0.1`).

```ts
import { apply } from "@flatwalk/resolver";
import { runDresserL1 } from "@flatwalk/ai/dresser";

const { patch, diagnostics } = runDresserL1({ model: accepted });
const next = apply(accepted, patch, {
  schemaVersion: "0.1",
  modelId: accepted.id,
  baseRevision: accepted.revision,
  currentRevision: accepted.revision,
  changes: [],
});
```

Правила: голосуют только `parquet|tile|laminate`; `unknown` и фото без look не голосуют; уникальная мода побеждает; при равенстве максимума берётся fallback типа комнаты, если он среди победителей, иначе первый из `parquet`, `tile`, `laminate`; нет голосов → bathroom/wc/kitchen `tile`, иначе `parquet`. Мода — `basis: inferred`, fallback — `assumed`. Human-слоты не предлагаются. Повтор после apply с теми же зависимостями даёт `ops: []`. L2/fal в этом срезе не вызываются.

## geometry-repair (ограниченный срез)

Это **не** `proposeRepair`. Validator по-прежнему не экспортирует авторемонт. Цикл живёт здесь, потому что нужен `createGrokClient`.

```ts
import { createGrokClient } from "@flatwalk/ai";
import { runGeometryRepair } from "@flatwalk/ai/geometry-repair";

const grok = createGrokClient({ mode: "fixture" }); // live только явно; нужен XAI_API_KEY
const result = await runGeometryRepair({
  model: accepted, // обязателен
  report,          // ValidationReport этой ревизии; иначе validate() внутри
  grok,
});
```

Вход: принятая модель + диагностика. Выход: кандидат `Patch` (`module: geometry-repair/grok@0.1`) либо отказ. Каждый кандидат идёт в Resolver, затем `validate` принятой ревизии. Максимум две попытки. Стоп: нет геометрических fail, `refuse`, невалидный патч, нет прогресса, тот же набор fail, отказ Resolver, исчерпание попыток. Human не затирается, confidence не повышается. CLI и Viewer не вызывают этот API в этом срезе.

Fixture: `fixtures/grok/geometry-repair.fixable.1.json` (`fixtureId` + `.${attempt}`). Нет файла — `missing-fixture`. Живой x.ai в этой задаче не вызывался.


