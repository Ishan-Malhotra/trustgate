const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g

/**
 * Flatten attacker-controlled catalog fields so they cannot inject
 * extra instruction lines into LLM tool output or audit summaries.
 */
export function sanitizeUntrustedText(
  value: string,
  maxLength = 160
): string {
  return value
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}
