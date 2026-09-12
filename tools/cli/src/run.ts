import type { AdapterMode } from "./adapters.ts";
import type { ParsedArgs } from "./args.ts";
import { runBuild } from "./build.ts";
import { CliError, EXIT } from "./errors.ts";
import { runImport } from "./import.ts";
import { loadLatestModel } from "./model-io.ts";
import { runNotImplemented } from "./not-implemented.ts";
import { printPipelineOutcome } from "./outcome.ts";
import { runParse } from "./parse.ts";
import { runLimitedRepair } from "./repair.ts";
import { runServe } from "./serve.ts";
import { stage } from "./stage.ts";
import { runValidate } from "./validate.ts";

export async function runPipeline(args: ParsedArgs, adapters: AdapterMode): Promise<void> {
  if (!args.runDir) throw new CliError(EXIT.usage, "run requires a run directory");
  if (!args.from && !args.url) {
    throw new CliError(EXIT.usage, "run requires --from <dir> or --url with --adapters live");
  }
  if (args.seed) {
    console.log("run: --seed is an explicit manual fallback, not recognition");
  }

  stage("import", adapters);
  await runImport(args, adapters);

  stage("parse", "python plan_parser → grok-rects fallback");
  await runParse(args.runDir, adapters);

  stage("validate");
  let report = await runValidate(args.runDir);

  stage("repair", "runGeometryRepair; proposeRepair is not called");
  const repair = await runLimitedRepair(args.runDir, adapters);
  if (repair === "applied") report = await runValidate(args.runDir);

  stage("match");
  await runNotImplemented(
    "match",
    args.runDir,
    "Photo Matcher library exists, but CLI does not apply the synthetic fixture IDs onto listing 54541",
  );

  stage("dress");
  await runNotImplemented("dress", args.runDir, "Dresser L1/L2 public apply API is not exported");

  stage("build");
  await runBuild(args.runDir);

  const model = await loadLatestModel(args.runDir);
  printPipelineOutcome(model, report, args.runDir);

  stage("serve", "print Viewer command; use `serve` to start");
  await runServe(args.runDir, { start: false });
}
