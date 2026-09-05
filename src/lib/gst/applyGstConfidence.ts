import type { ConfidenceResult } from "@/lib/trust/confidence"
import type { GstTaxpayerRecord } from "@/lib/gst/verifyGstin"

/**
 * Overlay GST identity signals onto MCA-derived confidence.
 * Does not invent trust — GST never substitutes for an MCA hit.
 * Active GST on an MCA miss stays low-band (trial hold), not medium (which
 * used to fall through to capture in evaluateTrust).
 */
export function applyGstConfidenceOverlay(
  base: ConfidenceResult,
  gst: GstTaxpayerRecord | null | undefined
): ConfidenceResult {
  if (!gst) return base

  if (gst.source === "invalid") {
    return {
      ...base,
      reasons: [
        ...base.reasons,
        `GSTIN invalid (${gst.validation.reason ?? "format"})`,
      ],
    }
  }

  if (gst.statusNormalized === "cancelled" || gst.statusNormalized === "suspended") {
    return {
      level: Math.min(base.level, 15),
      band: "low",
      reasons: [
        ...base.reasons,
        `GST status ${gst.statusNormalized}${gst.legalName ? ` (${gst.legalName})` : ""} — adverse tax-registry signal`,
      ],
      adverseStatus: true,
      elevatedRisk: true,
    }
  }

  const reasons = [...base.reasons]

  if (gst.source === "format-only") {
    reasons.push(
      `GSTIN ${gst.gstin} format/checksum valid — taxpayer details not fetched`
    )
    if (base.band === "low" && base.level <= 20) {
      return {
        ...base,
        level: Math.max(base.level, 25),
        reasons,
        adverseStatus: false,
        elevatedRisk: base.elevatedRisk,
      }
    }
    return { ...base, reasons }
  }

  if (gst.statusNormalized === "active" && gst.legalName) {
    reasons.push(
      `GST Active: ${gst.legalName}${gst.tradeName ? ` (trade: ${gst.tradeName})` : ""}`
    )
    // Cancelled GST already returned. Do not let Active GST wash MCA
    // dormant / not-Active elevated risk, or invent a medium band from a miss.
    if (base.adverseStatus || base.elevatedRisk) {
      return { ...base, reasons }
    }
    if (base.band === "low") {
      return {
        ...base,
        level: Math.max(base.level, 30),
        band: "low",
        reasons,
      }
    }
    if (base.band === "medium") {
      return {
        ...base,
        level: Math.max(base.level, 55),
        reasons,
      }
    }
    return { ...base, reasons }
  }

  if (gst.legalName) {
    reasons.push(`GST legal name: ${gst.legalName}`)
  }

  return { ...base, reasons }
}
