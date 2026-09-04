import type { ConfidenceResult } from "@/lib/trust/confidence"
import type { GstTaxpayerRecord } from "@/lib/gst/verifyGstin"

/**
 * Overlay GST identity signals onto MCA-derived confidence.
 * Does not invent trust scores — only adjusts confidence band/reasons.
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
    if (!base.adverseStatus && base.band === "low") {
      return {
        level: Math.max(base.level, 45),
        band: "medium",
        reasons,
        adverseStatus: false,
        elevatedRisk: false,
      }
    }
    if (!base.adverseStatus && base.band === "medium") {
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
