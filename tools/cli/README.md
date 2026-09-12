# FlatWalk CLI

Локальный конвейер без Convex. Пакет зарегистрирован в корневом workspace. Прямой запуск из `tools/cli` сохранён.

## Fixture без `--seed`

```text
cd tools/cli
npx tsx src/index.ts run /tmp/flatwalk-54541 --from fixtures/54541
```

`--seed` не используется: import даёт rev 0 без геометрии, parse вызывает `python -m plan_parser`, при пустом/ошибке/таймауте 60 с — fixture `grok-rects` (синтетика, не распознавание плана 54541). Repair не вызывается, пока Validator не экспортирует `proposeRepair`. Viewer не стартует из `run`; печатается команда.

Открыть Viewer:

```text
npx tsx src/index.ts serve /tmp/flatwalk-54541 --print-cmd
# или без --print-cmd — npm run dev в modules/viewer с FLATWALK_RUN
```

Live только явно (`--adapters live` / `--live` / `FLATWALK_ADAPTERS=live`). Значения ключей CLI не печатает. Нет ключа — live не подменяется fixture.

```text
npx tsx src/index.ts run /tmp/flatwalk-54541-live --from fixtures/54541 --adapters live --force
```

## Ручной эталон (`--seed` — явный запасной режим)

```text
npx tsx src/index.ts import /tmp/flatwalk-54541 --from fixtures/54541 --seed
npx tsx src/index.ts validate /tmp/flatwalk-54541
npx tsx src/index.ts build /tmp/flatwalk-54541
npx tsx src/index.ts serve /tmp/flatwalk-54541 --print-cmd
```

Установка: `npm install --workspaces=false` в `tools/cli`. Нужен собранный `@flatwalk/contract` (`npm run build` в `modules/contract`), если нет `dist/`.

Существующую папку запуска CLI не перезаписывает без `--force`. Эталон в `fixtures/54541` не меняется.

Флаги и коды — `--help` и [orchestrator.md](../../../../docs/modules/orchestrator.md).
