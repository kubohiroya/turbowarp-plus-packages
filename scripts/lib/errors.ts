/** Formats thrown values at API and browser boundaries. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
