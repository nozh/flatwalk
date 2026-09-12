# FlatWalk CLI

Локальный конвейер без Convex. Пакет зарегистрирован в корневом workspace; его тесты входят в корневой `npm test`. Прямой запуск из `tools/cli` тоже сохранён.

## Запуск из корня репозитория кода

```text
npm run flatwalk -- import /tmp/flatwalk-54541 --from fixtures/54541 --seed
npm run flatwalk -- build /tmp/flatwalk-54541
npm test -w @flatwalk/cli
```

## Установка

Из `code/flatwalk-repo/tools/cli`:

```text
npm install --workspaces=false
```

Нужен собранный `@flatwalk/contract` (`npm run build` в `modules/contract`), если `dist/` ещё нет.

## Эталон → сцена

```text
npx tsx src/index.ts import /tmp/flatwalk-54541 --from fixtures/54541 --seed
npx tsx src/index.ts parse /tmp/flatwalk-54541
npx tsx src/index.ts validate /tmp/flatwalk-54541
npx tsx src/index.ts match /tmp/flatwalk-54541
npx tsx src/index.ts dress /tmp/flatwalk-54541
npx tsx src/index.ts build /tmp/flatwalk-54541
npx tsx src/index.ts serve /tmp/flatwalk-54541
```

`--from` и `--seed` ищутся относительно текущей папки и корня `code/flatwalk-repo`.

`--seed` подкладывает ручной `flat.model.json` вместо распознавания. Это не Parser.

По умолчанию `fixture`. `--url` вызывает сеть только с `--adapters live` (или `FLATWALK_ADAPTERS=live`). Отсутствующая фикстура не переключает выполнение в live.

Существующую папку запуска CLI не перезаписывает без `--force`. Эталон в `fixtures/54541` не меняется.

Флаги, коды выхода и статус этапов — `--help` и [orchestrator.md](../../../../docs/modules/orchestrator.md).
