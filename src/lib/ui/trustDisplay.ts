import type { SellerTrustCheck } from "@/lib/types"
import { tierColor } from "@/lib/ui/types"

export interface TrustDisplayLine {
  label: string
  value: string
  className?: string
}

function capitalizeBand(band: string): string {
  return band.charAt(0).toUpperCase() + band.slice(1)
}

function confidenceColor(band: "high" | "medium" | "low"): string {
  switch (band) {
    case "high":
      return "text-emerald-400"
    case "medium":
      return "text-amber-400"
    case "low":
      return "text-sky-400"
  }
}

/** Low confidence + empty history — score 0 means unknown, not definitively bad. */
function isUnknownHistoryCase(check: SellerTrustCheck): boolean {
  if (!check.liveLookup || !check.confidenceBand) return false
  if (check.confidenceBand !== "low") return false
  if ((check.confidenceLevel ?? 0) > 25) return false
  return check.riskScore <= 25 && check.effectiveScore <= 25
}

/**
 * Build labeled trust/confidence lines for UI — keeps confidence separate from risk.
 */
export function buildTrustDisplayLines(
  check: SellerTrustCheck
): TrustDisplayLine[] {
  const lines: TrustDisplayLine[] = []

  if (check.liveLookup && check.confidenceBand) {
    const pct =
      check.confidenceLevel !== undefined ? ` (${check.confidenceLevel}%)` : ""
    lines.push({
      label: "Confidence",
      value: `${capitalizeBand(check.confidenceBand)}${pct}`,
      className: confidenceColor(check.confidenceBand),
    })

    if (isUnknownHistoryCase(check)) {
      lines.push({
        label: "Risk signals",
        value: "Unknown — no transaction history (not scored as bad)",
        className: "text-zinc-400",
      })
    } else if (check.riskScore !== check.effectiveScore) {
      lines.push({
        label: "Risk signals",
        value: `${check.riskScore} (${check.riskTier})`,
        className: tierColor(check.riskTier),
      })
      lines.push({
        label: "Effective trust",
        value: `${check.effectiveScore} (${check.effectiveTier})`,
        className: tierColor(check.effectiveTier),
      })
    } else {
      lines.push({
        label: "Risk signals",
        value: `${check.riskScore} (${check.riskTier})`,
        className: tierColor(check.riskTier),
      })
    }
  } else {
    if (check.riskScore !== check.score) {
      lines.push({
        label: "Risk signals",
        value: `${check.riskScore} (${check.riskTier})`,
        className: tierColor(check.riskTier),
      })
      lines.push({
        label: "Effective trust",
        value: `${check.score} (${check.tier})`,
        className: tierColor(check.tier),
      })
    } else {
      lines.push({
        label: "Trust",
        value: `${check.score} (${check.tier})`,
        className: tierColor(check.tier),
      })
    }
  }

  return lines
}
