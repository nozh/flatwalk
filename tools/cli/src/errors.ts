export const EXIT = {
  ok: 0,
  usage: 1,
  runFolder: 2,
  model: 3,
  adapters: 4,
  io: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly details: string[];

  constructor(exitCode: ExitCode, message: string, details: string[] = []) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function formatZodIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
