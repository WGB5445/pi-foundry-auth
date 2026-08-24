const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/giu;

export function redactSecrets(message: string): string {
  return message.replace(BEARER_PATTERN, "Bearer [redacted]").replace(JWT_PATTERN, "[redacted-token]");
}
