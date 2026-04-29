const UPPER_BRACE_TOKEN_RE = /\b[A-Z0-9_]{2,20}\{[^}]{1,200}\}/g;

export function sanitizeScadaText(value: string): string {
  if (!value) return "";
  return value.replace(UPPER_BRACE_TOKEN_RE, "[REDACTED]");
}
