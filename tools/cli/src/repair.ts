import { PatchSchema, type FlatModel } from "@flatwalk/contract";
import { applyPublishedPatch } from "./patch-apply.ts";
import { loadLatestModel } from "./model-io.ts";

const MAX_REPAIR_PASSES = 2;

type ValidatorExports = {
  proposeRepair?: (model: FlatModel) => unknown;
};

export async function runLimitedRepair(runDir: string): Promise<"applied" | "skipped"> {
  const validator = (await import("@flatwalk/validator")) as ValidatorExports;
  if (typeof validator.proposeRepair !== "function") {
    console.log(
      "repair: skipped — @flatwalk/validator does not export proposeRepair. Diagnosis only; no dummy patch.",
    );
    return "skipped";
  }

  for (let pass = 1; pass <= MAX_REPAIR_PASSES; pass += 1) {
    const model = await loadLatestModel(runDir);
    const raw = validator.proposeRepair(model);
    const parsed = PatchSchema.safeParse(raw);
    if (!parsed.success) {
      console.log(`repair: pass ${pass} returned a non-Patch; stopping without a dummy repair`);
      return "skipped";
    }
    if (parsed.data.ops.length === 0) {
      console.log(`repair: pass ${pass} empty patch (idempotent); stopping`);
      return pass === 1 ? "skipped" : "applied";
    }
    const published = await applyPublishedPatch(
      runDir,
      parsed.data,
      "repair refused: Resolver did not accept proposeRepair. Previous model kept.",
    );
    console.log(
      `repair: pass ${pass} applied ${parsed.data.module} → ${published.patchFile} rev ${published.next.revision}`,
    );
  }
  return "applied";
}
