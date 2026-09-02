import { logAudit } from "@/lib/audit/logger"
import { getDataGovInApiKey } from "@/lib/config/env"

const MCA_RESOURCE_ID = "4dbe5667-7b6b-41d7-82af-211562424d9a"
const MCA_API_BASE = `https://api.data.gov.in/resource/${MCA_RESOURCE_ID}`
const PUBLIC_SAMPLE_KEY =
  "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"
const REQUEST_TIMEOUT_MS = 8000

const NAME_SUFFIXES = [
  "LIMITED",
  "PRIVATE LIMITED",
  "PVT LTD",
  "LTD",
  "LLP",
] as const

const CIN_PATTERN = /^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/

export interface MCARecord {
  cin: string
  companyName: string
  registrationDate: string | null
  status: string
  authorizedCapital: number
  paidupCapital: number
  state: string
  nicCode: string
  rocCode: string
}

export type McaLookupFailure = "no-match" | "timeout" | "api-error"

export type McaLookupSource = "api" | "verified-cache" | "lookup-cache"

export interface McaLookupResult {
  record: MCARecord | null
  source: McaLookupSource
  failureReason?: McaLookupFailure
}

interface McaApiRecord {
  CIN?: string
  CompanyName?: string
  CompanyRegistrationdate_date?: string
  CompanyStatus?: string
  AuthorizedCapital?: string
  PaidupCapital?: string
  CompanyStateCode?: string
  nic_code?: string
  CompanyROCcode?: string
}

interface McaApiResponse {
  records?: McaApiRecord[]
  status?: string
}

type FetchOutcome =
  | { kind: "records"; records: MCARecord[] }
  | { kind: "no-match" }
  | { kind: "api-error"; status?: number }
  | { kind: "timeout" }

const globalForMca = globalThis as unknown as {
  mcaVerifiedCache?: Map<string, MCARecord>
  mcaNameToCinCache?: Map<string, string>
  mcaNoMatchCache?: Set<string>
}

function getVerifiedCache(): Map<string, MCARecord> {
  if (!globalForMca.mcaVerifiedCache) {
    globalForMca.mcaVerifiedCache = new Map()
  }
  return globalForMca.mcaVerifiedCache
}

function getNameToCinCache(): Map<string, string> {
  if (!globalForMca.mcaNameToCinCache) {
    globalForMca.mcaNameToCinCache = new Map()
  }
  return globalForMca.mcaNameToCinCache
}

function getNoMatchCache(): Set<string> {
  if (!globalForMca.mcaNoMatchCache) {
    globalForMca.mcaNoMatchCache = new Set()
  }
  return globalForMca.mcaNoMatchCache
}

function normalizeCacheKey(name: string): string {
  return name.trim().toUpperCase()
}

function parseCapital(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function mapRecord(raw: McaApiRecord): MCARecord {
  return {
    cin: raw.CIN ?? "",
    companyName: raw.CompanyName ?? "",
    registrationDate: raw.CompanyRegistrationdate_date ?? null,
    status: raw.CompanyStatus ?? "",
    authorizedCapital: parseCapital(raw.AuthorizedCapital),
    paidupCapital: parseCapital(raw.PaidupCapital),
    state: raw.CompanyStateCode ?? "",
    nicCode: raw.nic_code ?? "",
    rocCode: raw.CompanyROCcode ?? "",
  }
}

function isCin(input: string): boolean {
  return CIN_PATTERN.test(input.trim().toUpperCase())
}

function normalizeCompanyName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ")
}

function buildNameCandidates(name: string): string[] {
  const base = normalizeCompanyName(name)
  const candidates = new Set<string>([base])

  for (const suffix of NAME_SUFFIXES) {
    if (!base.endsWith(suffix)) {
      candidates.add(`${base} ${suffix}`)
    }
  }

  return [...candidates]
}

function pickBestRecord(records: MCARecord[]): MCARecord | null {
  if (records.length === 0) return null
  if (records.length === 1) return records[0]

  const sorted = [...records].sort((a, b) => {
    const aActive = a.status.toLowerCase() === "active" ? 1 : 0
    const bActive = b.status.toLowerCase() === "active" ? 1 : 0
    if (aActive !== bActive) return bActive - aActive

    const aDate = a.registrationDate
      ? new Date(a.registrationDate).getTime()
      : Number.POSITIVE_INFINITY
    const bDate = b.registrationDate
      ? new Date(b.registrationDate).getTime()
      : Number.POSITIVE_INFINITY
    if (aDate !== bDate) return aDate - bDate

    return b.paidupCapital - a.paidupCapital
  })

  return sorted[0]
}

function storeVerifiedRecord(record: MCARecord, queryName: string): void {
  const verified = getVerifiedCache()
  const nameToCin = getNameToCinCache()

  verified.set(normalizeCacheKey(queryName), record)
  verified.set(normalizeCacheKey(record.companyName), record)
  if (record.cin) {
    verified.set(normalizeCacheKey(record.cin), record)
    nameToCin.set(normalizeCacheKey(queryName), record.cin)
    nameToCin.set(normalizeCacheKey(record.companyName), record.cin)
  }
}

function getFromVerifiedCache(query: string): MCARecord | null {
  const key = normalizeCacheKey(query)
  return getVerifiedCache().get(key) ?? null
}

async function fetchMcaRecords(
  filterKey: "CIN" | "CompanyName",
  filterValue: string
): Promise<FetchOutcome> {
  const apiKey = getDataGovInApiKey() ?? PUBLIC_SAMPLE_KEY
  const usingFallback = !getDataGovInApiKey()

  const params = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    limit: "10",
    offset: "0",
    [`filters[${filterKey}]`]: filterValue,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${MCA_API_BASE}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      logAudit(
        "trust_check",
        `[live-lookup] MCA API error: HTTP ${response.status}`,
        { filterKey, filterValue, usingFallback, failureReason: "api-error" }
      )
      return { kind: "api-error", status: response.status }
    }

    const data = (await response.json()) as McaApiResponse
    if (!data.records?.length) return { kind: "no-match" }

    return { kind: "records", records: data.records.map(mapRecord) }
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"))
    const failureReason: McaLookupFailure = isTimeout ? "timeout" : "api-error"
    const message = err instanceof Error ? err.message : String(err)

    logAudit(
      "trust_check",
      `[live-lookup] MCA API ${failureReason}: ${message}`,
      { filterKey, filterValue, usingFallback, failureReason }
    )
    return { kind: isTimeout ? "timeout" : "api-error" }
  } finally {
    clearTimeout(timeout)
  }
}

async function queryByName(name: string): Promise<FetchOutcome> {
  const candidates = buildNameCandidates(name)

  for (const candidate of candidates) {
    const outcome = await fetchMcaRecords("CompanyName", candidate)
    if (outcome.kind === "records") {
      const best = pickBestRecord(outcome.records)
      if (best) return { kind: "records", records: [best] }
    }
    if (outcome.kind === "api-error" || outcome.kind === "timeout") {
      return outcome
    }
  }

  return { kind: "no-match" }
}

async function queryByCin(cin: string): Promise<FetchOutcome> {
  const outcome = await fetchMcaRecords("CIN", cin.trim().toUpperCase())
  if (outcome.kind !== "records") return outcome

  const best = pickBestRecord(outcome.records)
  if (!best) return { kind: "no-match" }
  return { kind: "records", records: [best] }
}

function outcomeToResult(
  outcome: FetchOutcome,
  queryName: string,
  source: McaLookupSource
): McaLookupResult {
  if (outcome.kind === "records") {
    const record = outcome.records[0]
    storeVerifiedRecord(record, queryName)
    return { record, source }
  }

  if (outcome.kind === "no-match") {
    getNoMatchCache().add(normalizeCacheKey(queryName))
    return { record: null, source, failureReason: "no-match" }
  }

  return {
    record: null,
    source,
    failureReason: outcome.kind,
  }
}

export async function searchCompanyDetailed(
  name: string
): Promise<McaLookupResult> {
  const trimmed = name.trim()
  if (!trimmed) {
    return { record: null, source: "api", failureReason: "no-match" }
  }

  const cacheKey = normalizeCacheKey(trimmed)
  const verified = getFromVerifiedCache(trimmed)
  if (verified) {
    logAudit(
      "trust_check",
      `[live-lookup] Verified cache hit for ${verified.companyName} (${verified.cin})`,
      { cin: verified.cin, source: "verified-cache" }
    )
    return { record: verified, source: "verified-cache" }
  }

  if (getNoMatchCache().has(cacheKey)) {
    return { record: null, source: "lookup-cache", failureReason: "no-match" }
  }

  let outcome: FetchOutcome

  if (isCin(trimmed)) {
    outcome = await queryByCin(trimmed)
    if (outcome.kind === "records") {
      const result = outcomeToResult(outcome, trimmed, "api")
      logAudit(
        "trust_check",
        `[live-lookup] Found ${result.record!.companyName} (${result.record!.cin}) — ${result.record!.status}`,
        { cin: result.record!.cin, status: result.record!.status }
      )
      return result
    }

    const cinFallback = getFromVerifiedCache(trimmed)
    if (cinFallback) {
      return { record: cinFallback, source: "verified-cache" }
    }
  } else {
    outcome = await queryByName(trimmed)

    if (outcome.kind === "no-match") {
      const cachedCin = getNameToCinCache().get(cacheKey)
      if (cachedCin) {
        const cinOutcome = await queryByCin(cachedCin)
        if (cinOutcome.kind === "records") {
          const result = outcomeToResult(cinOutcome, trimmed, "api")
          logAudit(
            "trust_check",
            `[live-lookup] Found ${result.record!.companyName} via CIN retry (${cachedCin})`,
            { cin: cachedCin, retry: "cin-cache" }
          )
          return result
        }
        if (cinOutcome.kind === "api-error" || cinOutcome.kind === "timeout") {
          const fallback = getFromVerifiedCache(trimmed)
          if (fallback) {
            return { record: fallback, source: "verified-cache" }
          }
          return outcomeToResult(cinOutcome, trimmed, "api")
        }
      }
    }

    if (outcome.kind === "records") {
      const result = outcomeToResult(outcome, trimmed, "api")
      logAudit(
        "trust_check",
        `[live-lookup] Found ${result.record!.companyName} (${result.record!.cin}) — ${result.record!.status}`,
        { cin: result.record!.cin, status: result.record!.status }
      )
      return result
    }

    if (outcome.kind === "api-error" || outcome.kind === "timeout") {
      const fallback = getFromVerifiedCache(trimmed)
      if (fallback) {
        logAudit(
          "trust_check",
          `[live-lookup] Verified cache fallback after ${outcome.kind} for "${trimmed}"`,
          { cin: fallback.cin, failureReason: outcome.kind }
        )
        return { record: fallback, source: "verified-cache" }
      }
      return outcomeToResult(outcome, trimmed, "api")
    }
  }

  const result = outcomeToResult(outcome, trimmed, "api")
  if (result.failureReason === "no-match") {
    logAudit(
      "trust_check",
      `[live-lookup] No MCA match for "${trimmed}" (genuinely not in registry)`,
      { query: trimmed, failureReason: "no-match" }
    )
  }
  return result
}

export async function searchCompany(name: string): Promise<MCARecord | null> {
  const result = await searchCompanyDetailed(name)
  return result.record
}

export function clearMcaCache(): void {
  globalForMca.mcaVerifiedCache = new Map()
  globalForMca.mcaNameToCinCache = new Map()
  globalForMca.mcaNoMatchCache = new Set()
}
