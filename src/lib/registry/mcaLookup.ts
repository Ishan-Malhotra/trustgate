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

const globalForMca = globalThis as unknown as {
  mcaLookupCache?: Map<string, MCARecord | null>
}

function getCache(): Map<string, MCARecord | null> {
  if (!globalForMca.mcaLookupCache) {
    globalForMca.mcaLookupCache = new Map()
  }
  return globalForMca.mcaLookupCache
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

async function fetchMcaRecords(
  filterKey: "CIN" | "CompanyName",
  filterValue: string
): Promise<MCARecord[]> {
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
        { filterKey, filterValue, usingFallback }
      )
      return []
    }

    const data = (await response.json()) as McaApiResponse
    if (!data.records?.length) return []

    return data.records.map(mapRecord)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logAudit("trust_check", `[live-lookup] MCA API unreachable: ${message}`, {
      filterKey,
      filterValue,
      usingFallback,
    })
    return []
  } finally {
    clearTimeout(timeout)
  }
}

async function queryByName(name: string): Promise<MCARecord | null> {
  const candidates = buildNameCandidates(name)

  for (const candidate of candidates) {
    const records = await fetchMcaRecords("CompanyName", candidate)
    const best = pickBestRecord(records)
    if (best) return best
  }

  return null
}

async function queryByCin(cin: string): Promise<MCARecord | null> {
  const records = await fetchMcaRecords("CIN", cin.trim().toUpperCase())
  return pickBestRecord(records)
}

export async function searchCompany(name: string): Promise<MCARecord | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const cacheKey = normalizeCacheKey(trimmed)
  const cache = getCache()
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null
  }

  let result: MCARecord | null = null

  try {
    if (isCin(trimmed)) {
      result = await queryByCin(trimmed)
    } else {
      result = await queryByName(trimmed)
    }
  } catch {
    result = null
  }

  cache.set(cacheKey, result)

  if (result) {
    logAudit(
      "trust_check",
      `[live-lookup] Found ${result.companyName} (${result.cin}) — ${result.status}`,
      { cin: result.cin, status: result.status, state: result.state }
    )
  } else {
    logAudit(
      "trust_check",
      `[live-lookup] No MCA match for "${trimmed}"`,
      { query: trimmed }
    )
  }

  return result
}

export function clearMcaCache(): void {
  globalForMca.mcaLookupCache = new Map()
}
