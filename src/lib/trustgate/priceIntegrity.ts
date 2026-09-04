import type { PriceIntegrityResult } from "@/lib/catalog/types"

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

export function checkPriceIntegrity(
  quotedPrice: number,
  peerPrices: number[]
): PriceIntegrityResult {
  if (!Number.isFinite(quotedPrice) || quotedPrice <= 0) {
    return {
      quotedPrice,
      anomaly: "extreme",
      reason: "Price integrity refused: missing or invalid quoted price.",
    }
  }

  const peers = peerPrices.filter((p) => Number.isFinite(p) && p > 0)
  if (peers.length < 2) {
    return {
      quotedPrice,
      anomaly: "none",
      reason:
        "Price integrity: fewer than 2 matching peer prices — no anomaly inferred (will not invent market price).",
    }
  }

  const med = median(peers)
  const min = Math.min(...peers)
  const max = Math.max(...peers)
  const ratio = quotedPrice / med
  const referenceRange = { min, max }

  if (ratio < 0.15 || ratio > 6) {
    return {
      quotedPrice,
      referenceRange,
      anomaly: "extreme",
      reason: `Extreme price anomaly: quoted ₹${quotedPrice} vs peer median ₹${Math.round(med)} (range ₹${min}–₹${max}, ratio ${ratio.toFixed(3)}).`,
    }
  }

  if (ratio < 0.4 || ratio > 2.5) {
    return {
      quotedPrice,
      referenceRange,
      anomaly: "moderate",
      reason: `Moderate price anomaly: quoted ₹${quotedPrice} vs peer median ₹${Math.round(med)} (range ₹${min}–₹${max}, ratio ${ratio.toFixed(3)}).`,
    }
  }

  return {
    quotedPrice,
    referenceRange,
    anomaly: "none",
    reason: `Price within peer band: quoted ₹${quotedPrice}, peers ₹${min}–₹${max} (median ₹${Math.round(med)}).`,
  }
}
