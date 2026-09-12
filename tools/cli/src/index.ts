#!/usr/bin/env npx tsx
import { resolveAdapterMode } from "./adapters.ts";
import { parseArgs, USAGE } from "./args.ts";
import { runBuild } from "./build.ts";
import { CliError, EXIT } from "./errors.ts";
import { runImport } from "./import.ts";
import { runNotImplemented } from "./not-implemented.ts";
import { runValidate } from "./validate.ts";

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`usage: ${message}`);
    console.error("See --help for commands.");
    process.exitCode = EXIT.usage;
    return;
  }

  if (args.help || !args.command) {
    console.log(USAGE);
    return;
  }

  if (!args.runDir) {
    console.error(`usage: ${args.command} requires a run directory`);
    process.exitCode = EXIT.usage;
    return;
  }

  const adapters = resolveAdapterMode({ flag: args.adapters, env: process.env });
  console.log(`adapters: ${adapters}`);

  switch (args.command) {
    case "import":
      await runImport(args, adapters);
      break;
    case "parse":
      await runNotImplemented(
        "parse",
        args.runDir,
        "Plan Parser / grok-rects не подключены к CLI. Для демо используйте import --seed",
      );
      break;
    case "validate":
      await runValidate(args.runDir);
      break;
    case "match":
      await runNotImplemented("match", args.runDir, "Photo Matcher не подключён; нет сохранённого ответа как патча");
      break;
    case "dress":
      await runNotImplemented("dress", args.runDir, "Dresser не подключён; L1/L2 не генерируются");
      break;
    case "build":
      await runBuild(args.runDir);
      break;
    case "serve":
      await runNotImplemented(
        "serve",
        args.runDir,
        "Viewer static на папке запуска ещё не вызван из CLI; файлы Viewer не менялись",
      );
      break;
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(error.message);
    for (const detail of error.details.slice(0, 20)) console.error(`  ${detail}`);
    if (error.details.length > 20) console.error(`  … ${error.details.length - 20} more`);
    process.exitCode = error.exitCode;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = EXIT.io;
});
