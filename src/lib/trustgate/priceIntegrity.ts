import type { PriceIntegrityResult } from "@/lib/catalog/types"

/**
 * Price integrity — peer median (spec notes for audit / PREP):
 *
 * WHERE peers come from:
 *   Only other product-matching listings in THIS search batch (same IndiaMART /
 *   catalog shortlist after product integrity). There is no stored market index
 *   or historical price table.
 *
 * TYPICAL sample size:
 *   MAX_CATALOG_CANDIDATES is currently 3, so a batch almost never has a
 *   meaningful peer distribution. A median of 2–3 prices is not statistics —
 *   one odd listing skews it entirely.
 *
 * THRESHOLDS (heuristic ratios vs peer median — not calibrated MSRP data):
 *   extreme  — quoted/median < 0.15 or > 6
 *   moderate — quoted/median < 0.4 or > 2.5
 *   none     — otherwise
 *
 * GUARDRAILS:
 *   - Require MIN_PRICE_POOL_SIZE priced product-matching candidates in the
 *     batch before inferring any anomaly (do not lower this to “make it fire”).
 *   - Anomaly is a soft confidence/audit signal only — never a standalone REFUSE.
 */

/** Minimum priced product-matching listings in the batch before anomaly can fire. */
export const MIN_PRICE_POOL_SIZE = 5

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
  peerPrices: number[],
  options?: { poolSize?: number }
): PriceIntegrityResult {
  if (!Number.isFinite(quotedPrice) || quotedPrice <= 0) {
    return {
      quotedPrice,
      anomaly: "none",
      reason:
        "Price integrity skipped: missing or invalid quoted price (not treated as anomaly).",
    }
  }

  const poolSize = options?.poolSize ?? peerPrices.length + 1
  if (poolSize < MIN_PRICE_POOL_SIZE) {
    return {
      quotedPrice,
      anomaly: "none",
      reason: `Price integrity skipped: candidate pool size ${poolSize} < ${MIN_PRICE_POOL_SIZE} — no valid peer distribution (batch-only peers; median not meaningful).`,
    }
  }

  const peers = peerPrices.filter((p) => Number.isFinite(p) && p > 0)
  // Need enough other peers to form a median once the pool clears MIN_PRICE_POOL_SIZE
  if (peers.length < MIN_PRICE_POOL_SIZE - 1) {
    return {
      quotedPrice,
      anomaly: "none",
      reason: `Price integrity skipped: only ${peers.length} peer price(s) (need ≥${MIN_PRICE_POOL_SIZE - 1} peers within a pool of ≥${MIN_PRICE_POOL_SIZE}).`,
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
      reason: `Extreme price anomaly (soft signal only — not a standalone refuse): quoted ₹${quotedPrice} vs peer median ₹${Math.round(med)} (range ₹${min}–₹${max}, ratio ${ratio.toFixed(3)}).`,
    }
  }

  if (ratio < 0.4 || ratio > 2.5) {
    return {
      quotedPrice,
      referenceRange,
      anomaly: "moderate",
      reason: `Moderate price anomaly (soft signal only): quoted ₹${quotedPrice} vs peer median ₹${Math.round(med)} (range ₹${min}–₹${max}, ratio ${ratio.toFixed(3)}).`,
    }
  }

  return {
    quotedPrice,
    referenceRange,
    anomaly: "none",
    reason: `Price within peer band: quoted ₹${quotedPrice}, peers ₹${min}–₹${max} (median ₹${Math.round(med)}).`,
  }
}
