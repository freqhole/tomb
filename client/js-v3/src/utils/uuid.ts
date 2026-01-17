// uuid v4 generator using crypto api

export function generateUUID(): string {
  return crypto.randomUUID();
}
