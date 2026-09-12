import type { FlatModel, Patch } from "@flatwalk/contract";
import { CliError, EXIT } from "./errors.ts";

export function bindPatchToModel(patch: Patch, model: FlatModel): {
  patch: Patch;
  remappedFrom: string;
} {
  if (patch.baseRevision !== model.revision) {
    throw new CliError(
      EXIT.model,
      `Saved patch baseRevision ${patch.baseRevision} does not match imported model ${model.id} rev ${model.revision}`,
    );
  }
  return {
    patch: {
      ...patch,
      modelId: model.id,
      baseRevision: model.revision,
    },
    remappedFrom: patch.modelId,
  };
}
