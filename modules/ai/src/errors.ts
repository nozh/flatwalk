export type AdapterErrorCode =
  | "missing-config"
  | "missing-fixture"
  | "timeout"
  | "api-error"
  | "invalid-response"
  | "invalid-mode";

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly status?: number;
  readonly details?: string;

  constructor(
    code: AdapterErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown; details?: string },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AdapterError";
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;
  }
}
