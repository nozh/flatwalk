import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ValidationReportSchema, type FlatModel, type ValidationReport } from "@flatwalk/contract";
import { validate } from "@flatwalk/validator";
import { CliError, EXIT, formatZodIssues } from "./errors.ts";
import { requireRunDir } from "./layout.ts";
import { loadLatestModel } from "./model-io.ts";

export const GRAPH_WALK_STATUS = "Связность комнат проверена. Ширина проходов не проверена";

export function reportWalkStatus(model: FlatModel, report: ValidationReport): string {
  if (report.modelId !== model.id || report.revision !== model.revision) {
    throw new CliError(
      EXIT.model,
      `ValidationReport modelId/revision (${report.modelId} rev ${report.revision}) does not match model ${model.id} rev ${model.revision}`,
    );
  }
  const clearance = report.checks.find((check) => check.checkId === "navigation.clearance");
  const lines = [
    `validate: report modelId=${report.modelId} revision=${report.revision} matches the current model`,
    `validate: walkReady=${report.walkReady} navigation.clearance=${clearance?.status ?? "absent"}`,
  ];
  if (report.walkReady && clearance?.status === "skipped") {
    lines.push(`validate: ${GRAPH_WALK_STATUS}`);
    lines.push("validate: это не полная готовность прогулки; пробная прогулка и диагностика доступны");
  } else if (report.walkReady) {
    lines.push("validate: walkReady не читается как полная готовность прогулки без проверки ширины проходов");
  } else {
    lines.push("validate: полная готовность прогулки не объявляется; пробная прогулка и диагностика сохранены");
  }
  lines.push("validate: цикл ремонта (proposeRepair) пока не подключён; отчёт записан без автопатча");
  return lines.join("\n");
}

export async function runValidate(runDir: string): Promise<ValidationReport> {
  const paths = await requireRunDir(runDir);
  const model = await loadLatestModel(paths.root);
  let report: ValidationReport;
  try {
    report = await validate(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(EXIT.model, `Failed to run @flatwalk/validator: ${message}`);
  }
  const parsed = ValidationReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new CliError(
      EXIT.model,
      "Validator returned a value that is not a Contract ValidationReport",
      formatZodIssues(parsed.error.issues),
    );
  }
  const status = reportWalkStatus(model, parsed.data);
  const out = path.join(paths.validation, `rev-${String(model.revision).padStart(3, "0")}.json`);
  await writeFile(out, `${JSON.stringify(parsed.data, null, 2)}\n`);
  console.log(`validate: ${out}`);
  console.log(status);
  return parsed.data;
}
