import { getApifyToken, getIndiamartActorId } from "@/lib/config/env"
import { logAudit } from "@/lib/audit/logger"
import type { CatalogCandidate } from "@/lib/catalog/types"

/** Apify sync scrapes are slow; 15s was aborting before results arrived. */
const REQUEST_TIMEOUT_MS = 90_000
const MAX_RESULTS = 10

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

function isSourabhActor(actorId: string): boolean {
  return actorId.includes("sourabhbgp")
}

/**
 * makework36 searchKeywords often returns [] for retail queries;
 * map common product phrases to IndiaMART category slugs as a fallback.
 */
export function inferIndiamartCategorySlug(query: string): string | null {
  const q = query.toLowerCase()
  if (/t[\s-]?shirts?|tee\b|tees\b/.test(q)) return "t-shirts"
  if (/hoodies?|sweatshirts?/.test(q)) return "hoodies"
  if (/jeans?\b/.test(q)) return "jeans"
  if (/sarees?|sari/.test(q)) return "sarees"
  if (/cotton fabric|fabrics?\b/.test(q)) return "cotton-fabric"
  if (/led\b|lights?\b/.test(q)) return "led-lights"
  return null
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
  supplierCity?: unknown
  url?: unknown
  companyUrl?: unknown
  supplierUrl?: unknown
  productUrl?: unknown
  gstNumber?: unknown
  price?: unknown
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
    parseIndiamartPrice(item.product?.price) ??
    parseIndiamartPrice(item.price)

  const cityRaw = item.city ?? item.supplierCity
  const city = typeof cityRaw === "string" ? cityRaw.trim() || null : null

  const sourceUrlCandidate = [
    item.companyUrl,
    item.url,
    item.supplierUrl,
    item.productUrl,
    item.product?.url,
  ].find((v) => typeof v === "string" && v.trim().length > 0)

  const sourceUrl =
    typeof sourceUrlCandidate === "string" ? sourceUrlCandidate.trim() : null

  const raw: Record<string, unknown> = {}
  const gstin =
    typeof item.gstNumber === "string" && item.gstNumber.trim()
      ? item.gstNumber.trim().toUpperCase()
      : null
  if (gstin) {
    raw.gstNumber = gstin
  }
  const productName =
    typeof item.productName === "string" && item.productName.trim()
      ? item.productName.trim()
      : null
  if (productName) {
    raw.productName = productName
  }

  return {
    merchantName,
    amount,
    currency: "INR",
    source: "indiamart",
    sourceUrl,
    city,
    productName,
    gstin,
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

function buildActorInput(actorId: string, query: string): Record<string, unknown> {
  if (isSourabhActor(actorId)) {
    return {
      mode: "search",
      searchQueries: [query],
      maxResults: MAX_RESULTS,
    }
  }

  return {
    searchKeywords: [query],
    maxSuppliersPerCategory: MAX_RESULTS,
  }
}

function buildCategoryFallbackInput(categorySlug: string): Record<string, unknown> {
  return {
    categorySlugs: [categorySlug],
    searchKeywords: [],
    maxSuppliersPerCategory: MAX_RESULTS,
  }
}

async function fetchActorItems(
  actorId: string,
  token: string,
  input: Record<string, unknown>
): Promise<{ ok: boolean; status: number; items: unknown[]; errorBody?: string }> {
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      return { ok: false, status: response.status, items: [], errorBody: body.slice(0, 400) }
    }

    const payload: unknown = await response.json()
    const items = Array.isArray(payload) ? payload : []
    return { ok: true, status: response.status, items }
  } finally {
    clearTimeout(timer)
  }
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
    logAudit(
      "error",
      "[search_catalog] APIFY_TOKEN missing — IndiaMART provider skipped",
      { query: trimmed }
    )
    return []
  }

  const actorId = getIndiamartActorId()

  try {
    let fetchResult = await fetchActorItems(
      actorId,
      token,
      buildActorInput(actorId, trimmed)
    )

    if (!fetchResult.ok) {
      logAudit(
        "error",
        `[search_catalog] IndiaMART Apify HTTP ${fetchResult.status}`,
        {
          query: trimmed,
          status: fetchResult.status,
          body: fetchResult.errorBody,
          actorId,
        }
      )
      return []
    }

    // makework36 keyword mode often returns []; retry via category slug.
    if (
      fetchResult.items.length === 0 &&
      !isSourabhActor(actorId)
    ) {
      const categorySlug = inferIndiamartCategorySlug(trimmed)
      if (categorySlug) {
        logAudit(
          "agent",
          `[search_catalog] IndiaMART keyword miss — retrying category "${categorySlug}"`,
          { query: trimmed, categorySlug, actorId }
        )
        fetchResult = await fetchActorItems(
          actorId,
          token,
          buildCategoryFallbackInput(categorySlug)
        )
        if (!fetchResult.ok) {
          logAudit(
            "error",
            `[search_catalog] IndiaMART category fallback HTTP ${fetchResult.status}`,
            {
              query: trimmed,
              categorySlug,
              status: fetchResult.status,
              body: fetchResult.errorBody,
            }
          )
          return []
        }
      }
    }

    const mapped = fetchResult.items
      .map((item) => mapIndiamartItem(item as IndiamartRawItem))
      .filter((c): c is CatalogCandidate => c !== null)

    const result = dedupeCandidates(mapped)
    cache.set(cacheKey, result)

    if (result.length === 0) {
      logAudit(
        "agent",
        `[search_catalog] IndiaMART returned 0 mappable suppliers for "${trimmed}"`,
        { query: trimmed, rawItemCount: fetchResult.items.length, actorId }
      )
    } else {
      logAudit(
        "agent",
        `[search_catalog] IndiaMART found ${result.length} supplier(s) for "${trimmed}"`,
        { query: trimmed, count: result.length, actorId }
      )
    }

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timedOut =
      (err instanceof Error && err.name === "AbortError") ||
      /aborted/i.test(message)
    logAudit(
      "error",
      timedOut
        ? `[search_catalog] IndiaMART Apify timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `[search_catalog] IndiaMART Apify error: ${message}`,
      { query: trimmed, actorId }
    )
    return []
  }
}
