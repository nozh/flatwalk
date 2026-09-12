export const COMMANDS = [
  "import",
  "parse",
  "validate",
  "match",
  "dress",
  "build",
  "serve",
  "run",
] as const;

export type Command = (typeof COMMANDS)[number];

export type AdapterFlag = "fixture" | "live";

export type ParsedArgs = {
  help: boolean;
  command?: Command;
  runDir?: string;
  from?: string;
  seed?: string | true;
  url?: string;
  adapters?: AdapterFlag;
  force: boolean;
  printCmd?: boolean;
};

export const USAGE = `FlatWalk CLI — локальный конвейер без Convex.

Запуск из code/flatwalk-repo/tools/cli (после npm install --workspaces=false):

  npx tsx src/index.ts <команда> <папка-запуска> [флаги]
  npm run flatwalk -- <команда> <папка-запуска> [флаги]

Команды (deploy.md §2.1):
  run        один прогон: import → parse → validate → repair? → build (match/dress явно не готовы)
  import     скопировать материалы и создать model/rev-000.json
  parse      python -m plan_parser, при пустом/ошибке/таймауте 60 с — grok-rects
  validate   публичный @flatwalk/validator; цикл ремонта только если есть proposeRepair
  match      Photo Matcher — не подключён к 54541 (синтетическая фикстура IDs)
  dress      Dresser — публичный apply API не экспортируется
  build      Builder: build/scene.snapshot.json и build/flat.glb
  serve      Viewer static: печатает команду; без --print-cmd запускает npm run dev

Fixture-путь без --seed (распознавание / grok-rects, не ручной эталон):

  npx tsx src/index.ts run /tmp/flatwalk-54541 --from fixtures/54541

Тот же прогон с явными live-адаптерами (сеть только если заданы переменные):

  npx tsx src/index.ts run /tmp/flatwalk-54541-live --from fixtures/54541 --adapters live --force

Ручной эталон вместо распознавания (--seed — только явный запасной режим):

  npx tsx src/index.ts import /tmp/flatwalk-54541 --from fixtures/54541 --seed
  npx tsx src/index.ts validate /tmp/flatwalk-54541
  npx tsx src/index.ts build /tmp/flatwalk-54541
  npx tsx src/index.ts serve /tmp/flatwalk-54541 --print-cmd

Флаги:
  --from <dir>           каталог материалов/эталона (относительно cwd или корня репозитория)
  --seed [file]          положить готовый FlatModel вместо parse (по умолчанию <from>/flat.model.json)
  --url <listing>        живой Importer; только вместе с --adapters live
  --adapters fixture|live  по умолчанию fixture; live только явно (также FLATWALK_ADAPTERS)
  --live                 синоним --adapters live
  --force                перезаписать существующую папку запуска
  --print-cmd            serve: только напечатать команду Viewer, не стартовать процесс
  -h, --help             эта справка

Коды выхода:
  0  успех (в том числе явный статус «не реализовано» у неготового этапа)
  1  ошибка использования
  2  папка запуска (существует без --force, неполная раскладка)
  3  нет модели / модель не проходит публичный Contract
  4  режим адаптеров (live без флага, отсутствие fixture не уходит в сеть)
  5  ошибка чтения/записи файлов

Из корня репозитория кода: npm run flatwalk -- <команда> <папка-запуска> [флаги].
`;

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const parsed: ParsedArgs = { help: false, force: false, printCmd: false };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--print-cmd") {
      parsed.printCmd = true;
      continue;
    }
    if (arg === "--live") {
      parsed.adapters = "live";
      continue;
    }
    if (arg === "--from") {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw usage("--from requires a directory");
      parsed.from = value;
      continue;
    }
    if (arg === "--url") {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw usage("--url requires a listing URL");
      parsed.url = value;
      continue;
    }
    if (arg === "--adapters") {
      const value = args[++i];
      if (value !== "fixture" && value !== "live") {
        throw usage('--adapters must be "fixture" or "live"');
      }
      parsed.adapters = value;
      continue;
    }
    if (arg === "--seed") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        parsed.seed = next;
        i += 1;
      } else {
        parsed.seed = true;
      }
      continue;
    }
    if (arg.startsWith("-")) throw usage(`unknown flag ${arg}`);
    positionals.push(arg);
  }

  const [command, runDir, extra] = positionals;
  if (extra) throw usage(`unexpected argument ${extra}`);
  if (command) {
    if (!isCommand(command)) throw usage(`unknown command ${command}`);
    parsed.command = command;
  }
  parsed.runDir = runDir;
  if (!parsed.command && !parsed.help) parsed.help = positionals.length === 0;
  return parsed;
}

export function usage(message: string): never {
  const error = new Error(message);
  error.name = "UsageError";
  throw error;
}
