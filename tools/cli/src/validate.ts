import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ValidationReportSchema, type FlatModel, type ValidationReport } from "@flatwalk/contract";
import { CliError, EXIT, formatZodIssues } from "./errors.ts";
import { requireRunDir } from "./layout.ts";
import { loadLatestModel } from "./model-io.ts";
import { repoRoot } from "./paths.ts";

type ValidatorModule = {
  validate?: (model: FlatModel) => ValidationReport | Promise<ValidationReport>;
};

async function loadValidator(): Promise<ValidatorModule | undefined> {
  const indexTs = path.join(repoRoot(), "modules/validator/src/index.ts");
  try {
    await access(indexTs);
  } catch {
    return undefined;
  }
  try {
    return (await import(pathToFileURL(indexTs).href)) as ValidatorModule;
  } catch {
    return undefined;
  }
}

export async function runValidate(runDir: string): Promise<void> {
  const paths = await requireRunDir(runDir);
  const model = await loadLatestModel(paths.root);
  const validator = await loadValidator();
  if (!validator?.validate) {
    console.log(
      "validate: не реализовано (публичный @flatwalk/validator недоступен). ValidationReport не создан — это не успешная проверка.",
    );
    return;
  }
  const report = await validator.validate(model);
  const parsed = ValidationReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new CliError(
      EXIT.model,
      "Validator returned a value that is not a Contract ValidationReport",
      formatZodIssues(parsed.error.issues),
    );
  }
  const out = path.join(paths.validation, `rev-${String(model.revision).padStart(3, "0")}.json`);
  await writeFile(out, `${JSON.stringify(parsed.data, null, 2)}\n`);
  console.log(`validate: ${out} walkReady=${parsed.data.walkReady}`);
}
