export class BuilderError extends Error {
  readonly code: 'contract' | 'geometry';
  readonly issues: string[];

  constructor(code: 'contract' | 'geometry', message: string, issues: string[] = []) {
    super(message);
    this.name = 'BuilderError';
    this.code = code;
    this.issues = issues;
  }
}
