import type { FlatModel, ValidationReport } from "@flatwalk/contract";
import { GRAPH_WALK_STATUS } from "./validate.ts";
import { printViewerOpen } from "./serve.ts";
import { runPaths } from "./paths.ts";

export function printPipelineOutcome(model: FlatModel, report: ValidationReport, runDir: string): void {
  const paths = runPaths(runDir);
  const clearance = report.checks.find((check) => check.checkId === "navigation.clearance");
  const failed = report.checks.filter((check) => check.status === "fail");

  console.log("\n── result ──");
  console.log(`result: model ${model.id} rev ${model.revision}`);
  console.log(`result: walkReady=${report.walkReady} navigation.clearance=${clearance?.status ?? "absent"}`);

  if (report.walkReady && clearance?.status === "skipped") {
    console.log(`result: ${GRAPH_WALK_STATUS}`);
    console.log("result: walkReady with clearance=skipped is not proof of physical walkability");
    console.log(`result: materials ${paths.materials}`);
    printViewerOpen(paths.root);
    return;
  }

  if (report.walkReady) {
    console.log("result: graph checks passed; treat physical walkability only if clearance is pass");
    printViewerOpen(paths.root);
    return;
  }

  console.log("result: model is not suitable for an advertised walk");
  console.log(`result: source materials ${paths.materials}`);
  console.log(`result: listing ${paths.listing}`);
  console.log(`result: validation ${pathJoin(paths.validation, model.revision)}`);
  if (failed.length === 0) {
    console.log("result: no fail checks; walkReady is false for another documented reason");
  } else {
    for (const check of failed.slice(0, 12)) {
      console.log(`result: fail ${check.checkId}: ${check.message}`);
    }
    if (failed.length > 12) console.log(`result: … ${failed.length - 12} more fail checks`);
  }
}

function pathJoin(validationDir: string, revision: number): string {
  return `${validationDir}/rev-${String(revision).padStart(3, "0")}.json`;
}
