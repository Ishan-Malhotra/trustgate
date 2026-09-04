/**
 * Untrusted shopping-agent proposal. TrustGate must verify independently —
 * the agent must not be able to assert "this is definitely a PS5" or "price is valid".
 */
export interface AgentProposal {
  productName: string | null
  productDescription?: string | null
  productUrl?: string | null
  price: number | null
  seller: string
  /** Vendor-agnostic source id (e.g. indiamart). */
  source: string
  gstin?: string | null
}

export function candidateToProposal(candidate: {
  merchantName: string
  amount: number | null
  source: string
  sourceUrl: string | null
  productName: string | null
  gstin: string | null
  raw?: Record<string, unknown>
}): AgentProposal {
  const rawName =
    typeof candidate.raw?.productName === "string"
      ? candidate.raw.productName
      : null
  return {
    productName: candidate.productName ?? rawName,
    productUrl: candidate.sourceUrl,
    price: candidate.amount,
    seller: candidate.merchantName,
    source: candidate.source,
    gstin: candidate.gstin,
  }
}
