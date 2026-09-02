import { getApifyToken, getIndiamartActorId } from "@/lib/config/env"
import type { CatalogCandidate } from "@/lib/catalog/types"

const REQUEST_TIMEOUT_MS = 15_000
const MAX_SUPPLIERS_PER_CATEGORY = 10

const globalForIndiamart = globalThis as unknown as {
  indiamartCache?: Map<string, CatalogCandidate[]>
}

function getCache(): Map<string, CatalogCandidate[]> {
  if (!globalForIndiamart.indiamartCache) {
    globalForIndiamart.indiamartCache = new Map()
  }
  return globalForIndiamart.indiamartCache
}

export function clearIndiamartCache(): void {
  getCache().clear()
}

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ")
}

function normalizeMerchantKey(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ")
}

/** Parse INR listing strings like "₹ 140 / Meter" or numeric fields. */
export function parseIndiamartPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value !== "string") return null

  const cleaned = value.replace(/,/g, "")
  const match = cleaned.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  return amount
}

interface IndiamartRawItem {
  companyName?: unknown
  city?: unknown
  url?: unknown
  supplierUrl?: unknown
  productUrl?: unknown
  gstNumber?: unknown
  product?: {
    price?: unknown
    priceNumeric?: unknown
    url?: unknown
  }
  [key: string]: unknown
}

export function mapIndiamartItem(item: IndiamartRawItem): CatalogCandidate | null {
  const merchantName =
    typeof item.companyName === "string" ? item.companyName.trim() : ""
  if (!merchantName) return null

  const amount =
    parseIndiamartPrice(item.product?.priceNumeric) ??
    parseIndiamartPrice(item.product?.price)

  const city = typeof item.city === "string" ? item.city.trim() || null : null

  const sourceUrlCandidate = [
    item.url,
    item.supplierUrl,
    item.productUrl,
    item.product?.url,
  ].find((v) => typeof v === "string" && v.trim().length > 0)

  const sourceUrl =
    typeof sourceUrlCandidate === "string" ? sourceUrlCandidate.trim() : null

  const raw: Record<string, unknown> = {}
  if (typeof item.gstNumber === "string" && item.gstNumber.trim()) {
    raw.gstNumber = item.gstNumber.trim()
  }

  return {
    merchantName,
    amount,
    currency: "INR",
    source: "indiamart",
    sourceUrl,
    city,
    ...(Object.keys(raw).length > 0 ? { raw } : {}),
  }
}

function dedupeCandidates(candidates: CatalogCandidate[]): CatalogCandidate[] {
  const seen = new Set<string>()
  const result: CatalogCandidate[] = []

  for (const candidate of candidates) {
    const key = normalizeMerchantKey(candidate.merchantName)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }

  return result
}

/**
 * IndiaMART catalog provider: search → normalize only.
 * Does not compute trust, inspect GST for approval, or invent candidates.
 */
export async function searchIndiamart(query: string): Promise<CatalogCandidate[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const cacheKey = normalizeQueryKey(trimmed)
  const cache = getCache()
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const token = getApifyToken()
  if (!token) {
    return []
  }

  const actorId = encodeURIComponent(getIndiamartActorId())
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchKeywords: [trimmed],
        maxSuppliersPerCategory: MAX_SUPPLIERS_PER_CATEGORY,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      cache.set(cacheKey, [])
      return []
    }

    const payload: unknown = await response.json()
    const items = Array.isArray(payload) ? payload : []
    const mapped = items
      .map((item) => mapIndiamartItem(item as IndiamartRawItem))
      .filter((c): c is CatalogCandidate => c !== null)

    const result = dedupeCandidates(mapped)
    cache.set(cacheKey, result)
    return result
  } catch {
    cache.set(cacheKey, [])
    return []
  } finally {
    clearTimeout(timer)
  }
}
