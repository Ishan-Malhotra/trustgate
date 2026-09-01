import type { MCARecord } from "@/lib/registry/mcaLookup"

export type ConfidenceBand = "high" | "medium" | "low"

export interface ConfidenceResult {
  level: number
  band: ConfidenceBand
  reasons: string[]
  adverseStatus: boolean
  elevatedRisk: boolean
}

const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000
const MIN_MEANINGFUL_CAPITAL = 100_000

const ADVERSE_STATUSES = [
  "struck off",
  "strike off",
  "under liquidation",
  "dissolved",
  "liquidated",
]

const DORMANT_STATUSES = ["dormant", "inactive"]

export function isAdverseMcaStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return ADVERSE_STATUSES.some((s) => normalized.includes(s))
}

export function isDormantMcaStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return DORMANT_STATUSES.some((s) => normalized.includes(s))
}

function registrationAgeMs(date: string | null): number | null {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  return Date.now() - parsed.getTime()
}

export function computeConfidence(
  mcaRecord: MCARecord | null
): ConfidenceResult {
  if (!mcaRecord) {
    return {
      level: 15,
      band: "low",
      reasons: [
        "Not found in MCA Company Master Data — insufficient verifiable history",
      ],
      adverseStatus: false,
      elevatedRisk: false,
    }
  }

  const reasons: string[] = []
  const status = mcaRecord.status
  const adverseStatus = isAdverseMcaStatus(status)

  if (adverseStatus) {
    return {
      level: 10,
      band: "low",
      reasons: [`MCA status is ${status} — adverse registry signal`],
      adverseStatus: true,
      elevatedRisk: true,
    }
  }

  const isActive = status.toLowerCase() === "active"
  const ageMs = registrationAgeMs(mcaRecord.registrationDate)
  const registeredOverTwoYears =
    ageMs !== null && ageMs > TWO_YEARS_MS
  const meaningfulCapital = mcaRecord.paidupCapital >= MIN_MEANINGFUL_CAPITAL

  if (isDormantMcaStatus(status)) {
    reasons.push(`MCA status is ${status}`)
    return {
      level: 20,
      band: "low",
      reasons,
      adverseStatus: false,
      elevatedRisk: true,
    }
  }

  if (!isActive) {
    reasons.push(`MCA status is ${status} (not Active)`)
    return {
      level: 25,
      band: "low",
      reasons,
      adverseStatus: false,
      elevatedRisk: true,
    }
  }

  reasons.push(`Found in MCA registry as ${mcaRecord.companyName}`)
  reasons.push(`Status: Active`)

  if (mcaRecord.registrationDate) {
    reasons.push(`Registered ${mcaRecord.registrationDate}`)
  }

  if (registeredOverTwoYears && meaningfulCapital) {
    reasons.push(
      `Established registration with paid-up capital ₹${mcaRecord.paidupCapital.toLocaleString("en-IN")}`
    )
    return {
      level: 85,
      band: "high",
      reasons,
      adverseStatus: false,
      elevatedRisk: false,
    }
  }

  if (!registeredOverTwoYears) {
    reasons.push("Recently registered — limited verifiable history")
  }
  if (!meaningfulCapital) {
    reasons.push("Thin paid-up capital in registry")
  }

  return {
    level: 50,
    band: "medium",
    reasons,
    adverseStatus: false,
    elevatedRisk: false,
  }
}
