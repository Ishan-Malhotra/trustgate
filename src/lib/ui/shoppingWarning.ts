import type { AuditEntry } from "@/lib/types"

export interface ShoppingWarningView {
  level: "caution" | "unreliable"
  message: string
  details: string[]
}

/** Pull TrustGate shopping-intervention warnings from audit / progress entries. */
export function extractShoppingWarning(
  entries: AuditEntry[]
): ShoppingWarningView | null {
  const warnings = entries.filter((e) => e.message.includes("[warning]"))
  if (warnings.length === 0) return null

  const latest = warnings[warnings.length - 1]
  const message = latest.message.replace("[warning]", "").trim()
  const level = /unreliable|repeatedly/i.test(message)
    ? "unreliable"
    : "caution"

  const details = entries
    .filter(
      (e) =>
        e.message.includes("[product]") || e.message.includes("[price]")
    )
    .map((e) =>
      e.message
        .replace("[product]", "")
        .replace("[price]", "")
        .trim()
    )
    .filter((d) => /mismatch|Extreme|anomaly|REFUSE/i.test(d))
    .slice(-6)

  return { level, message, details }
}
