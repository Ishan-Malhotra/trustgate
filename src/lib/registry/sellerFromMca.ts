import type { Seller } from "@/lib/types"
import type { MCARecord } from "./mcaLookup"

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
}

function daysSinceRegistration(date: string | null): number {
  if (!date) return 0
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return 0
  const diffMs = Date.now() - parsed.getTime()
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)))
}

export function buildLiveSellerId(
  name: string,
  mcaRecord: MCARecord | null
): string {
  if (mcaRecord?.cin) return `live:${mcaRecord.cin}`
  return `live:unknown:${slugify(name)}`
}

export function sellerFromMca(
  name: string,
  mcaRecord: MCARecord | null
): Seller {
  const isActive =
    mcaRecord?.status.toLowerCase() === "active"

  return {
    id: buildLiveSellerId(name, mcaRecord),
    name: mcaRecord?.companyName ?? name.trim(),
    category: mcaRecord?.nicCode
      ? `MCA NIC ${mcaRecord.nicCode}`
      : "Unknown merchant (live lookup)",
    account_age_days: daysSinceRegistration(
      mcaRecord?.registrationDate ?? null
    ),
    kyc_verified: Boolean(mcaRecord && isActive),
    dispute_rate_history: [],
    return_rate: 0,
    price_volatility: 0,
  }
}
