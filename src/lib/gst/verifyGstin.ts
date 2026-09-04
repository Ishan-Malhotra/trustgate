import { getEnvValue } from "@/lib/config/env"
import { logAudit } from "@/lib/audit/logger"
import {
  normalizeGstin,
  validateGstin,
  type GstinValidation,
} from "@/lib/gst/validateGstin"

const REQUEST_TIMEOUT_MS = 10_000
const GST_PORTAL_BASE =
  "https://services.gst.gov.in/services/api/search/taxpayerDetails"

export type GstLookupSource =
  | "portal"
  | "proxy"
  | "format-only"
  | "invalid"
  | "error"

export interface GstTaxpayerRecord {
  gstin: string
  legalName: string | null
  tradeName: string | null
  status: string | null
  /** Normalized Active / Cancelled / Suspended / Unknown */
  statusNormalized: "active" | "cancelled" | "suspended" | "unknown" | null
  registrationDate: string | null
  source: GstLookupSource
  validation: GstinValidation
}

const globalForGst = globalThis as unknown as {
  gstVerifyCache?: Map<string, GstTaxpayerRecord>
}

function getCache(): Map<string, GstTaxpayerRecord> {
  if (!globalForGst.gstVerifyCache) {
    globalForGst.gstVerifyCache = new Map()
  }
  return globalForGst.gstVerifyCache
}

export function clearGstCache(): void {
  getCache().clear()
}

function normalizeStatus(
  raw: string | null | undefined
): GstTaxpayerRecord["statusNormalized"] {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (s === "act" || s.includes("active")) return "active"
  if (s === "cnl" || s.includes("cancel")) return "cancelled"
  if (s === "sus" || s.includes("suspend")) return "suspended"
  return "unknown"
}

function mapPortalPayload(
  gstin: string,
  data: Record<string, unknown>,
  source: GstLookupSource,
  validation: GstinValidation
): GstTaxpayerRecord | null {
  const legalName =
    typeof data.lgnm === "string"
      ? data.lgnm.trim()
      : typeof data.legalName === "string"
        ? data.legalName.trim()
        : null
  const tradeName =
    typeof data.tradeNam === "string"
      ? data.tradeNam.trim()
      : typeof data.tradeName === "string"
        ? data.tradeName.trim()
        : null
  const statusRaw =
    typeof data.sts === "string"
      ? data.sts
      : typeof data.status === "string"
        ? data.status
        : null

  if (!legalName && !statusRaw) return null

  return {
    gstin,
    legalName: legalName || null,
    tradeName: tradeName || null,
    status: statusRaw,
    statusNormalized: normalizeStatus(statusRaw),
    registrationDate:
      typeof data.rgdt === "string"
        ? data.rgdt
        : typeof data.registrationDate === "string"
          ? data.registrationDate
          : null,
    source,
    validation,
  }
}

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) return { ok: false, data: null }
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("json")) {
      const text = await response.text()
      if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
        return { ok: false, data: null }
      }
      try {
        return { ok: true, data: JSON.parse(text) }
      } catch {
        return { ok: false, data: null }
      }
    }
    return { ok: true, data: await response.json() }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Verify a GSTIN: format/checksum always; taxpayer details when portal/proxy allows.
 * Never throws. Portal is often blocked from servers — then returns format-only.
 */
export async function verifyGstin(
  input: string
): Promise<GstTaxpayerRecord | null> {
  const validation = validateGstin(input)
  const gstin = validation.gstin || normalizeGstin(input)

  if (!validation.ok) {
    logAudit("agent", `[gst] Invalid GSTIN ${gstin || "(empty)"}`, {
      reason: validation.reason,
    })
    return {
      gstin,
      legalName: null,
      tradeName: null,
      status: null,
      statusNormalized: null,
      registrationDate: null,
      source: "invalid",
      validation,
    }
  }

  const cache = getCache()
  const cached = cache.get(gstin)
  if (cached) return cached

  const proxyUrl = getEnvValue("GST_VERIFY_URL")
  try {
    if (proxyUrl) {
      const url = proxyUrl.includes("{gstin}")
        ? proxyUrl.replace("{gstin}", encodeURIComponent(gstin))
        : `${proxyUrl.replace(/\/$/, "")}/${encodeURIComponent(gstin)}`
      const { ok, data } = await fetchJson(url)
      if (ok && data && typeof data === "object") {
        const mapped = mapPortalPayload(
          gstin,
          data as Record<string, unknown>,
          "proxy",
          validation
        )
        if (mapped) {
          cache.set(gstin, mapped)
          logAudit(
            "agent",
            `[gst] Verified ${gstin} via proxy — ${mapped.legalName ?? "no legal name"} (${mapped.statusNormalized ?? "unknown"})`,
            { gstin, source: "proxy", status: mapped.statusNormalized }
          )
          return mapped
        }
      }
    }

    const { ok, data } = await fetchJson(`${GST_PORTAL_BASE}/${gstin}`, {
      headers: {
        Referer: "https://services.gst.gov.in/services/searchtp",
        Origin: "https://services.gst.gov.in",
      },
    })

    if (ok && data && typeof data === "object") {
      const mapped = mapPortalPayload(
        gstin,
        data as Record<string, unknown>,
        "portal",
        validation
      )
      if (mapped) {
        cache.set(gstin, mapped)
        logAudit(
          "agent",
          `[gst] Verified ${gstin} via portal — ${mapped.legalName ?? "no legal name"} (${mapped.statusNormalized ?? "unknown"})`,
          { gstin, source: "portal", status: mapped.statusNormalized }
        )
        return mapped
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logAudit("error", `[gst] Lookup error for ${gstin}: ${message}`, { gstin })
  }

  const formatOnly: GstTaxpayerRecord = {
    gstin,
    legalName: null,
    tradeName: null,
    status: null,
    statusNormalized: null,
    registrationDate: null,
    source: "format-only",
    validation,
  }
  cache.set(gstin, formatOnly)
  logAudit(
    "agent",
    `[gst] GSTIN ${gstin} format/checksum valid — taxpayer details unavailable (portal blocked or unreachable)`,
    { gstin, source: "format-only" }
  )
  return formatOnly
}
