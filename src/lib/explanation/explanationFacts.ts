import type { PaymentAction, SellerTrustCheck } from "@/lib/types"

export type ExplanationAction = "approve" | "hold" | "refuse"

export type PrimaryReasonType =
  | "adverse_registry_status"
  | "insufficient_confidence"
  | "policy_threshold"
  | "clean_approval"

export interface ExplanationSellerFacts {
  name: string
  price: number
  action: ExplanationAction
  primaryReasonType: PrimaryReasonType
  primaryReasonDetail: string
  riskScore: number
  effectiveScore: number
  confidenceLevel: number
}

function mapAction(action: PaymentAction): ExplanationAction {
  if (action === "capture") return "approve"
  return action
}

function extractAdverseDetail(
  trustReason: string,
  confidenceReasons: string[]
): string {
  const mcaStatus = trustReason.match(/MCA status is [^)—]+/i)
  if (mcaStatus) return mcaStatus[0].trim()

  const elevated = trustReason.match(/Elevated registry risk \([^)]+\)/i)
  if (elevated) return elevated[0].trim()

  if (confidenceReasons[0]) return confidenceReasons[0]

  return trustReason.replace(/\s*—\s*seller refused$/i, "").trim()
}

export function classifyPrimaryReason(check: SellerTrustCheck): {
  primaryReasonType: PrimaryReasonType
  primaryReasonDetail: string
} {
  const trust = check.trustReason ?? ""
  const policy = check.policyReason ?? ""
  const confReasons = check.confidenceReasons ?? []

  const isAdverse =
    /adverse mca|elevated registry risk|cirp|struck off|under liquidation|dissolved/i.test(
      trust
    ) ||
    confReasons.some((r) =>
      /adverse|cirp|struck off|liquidation|not active/i.test(r)
    )

  if (check.recommendedAction === "refuse" && isAdverse) {
    return {
      primaryReasonType: "adverse_registry_status",
      primaryReasonDetail: extractAdverseDetail(trust, confReasons),
    }
  }

  if (policy && /exceeds|threshold|max spend/i.test(policy)) {
    return {
      primaryReasonType: "policy_threshold",
      primaryReasonDetail: policy,
    }
  }

  const isInsufficientConfidence =
    /insufficient verifiable history|not found in mca/i.test(trust) ||
    (check.liveLookup &&
      check.confidenceBand === "low" &&
      check.recommendedAction !== "refuse")

  if (isInsufficientConfidence) {
    return {
      primaryReasonType: "insufficient_confidence",
      primaryReasonDetail: confReasons[0] ?? trust,
    }
  }

  if (check.recommendedAction === "capture") {
    return {
      primaryReasonType: "clean_approval",
      primaryReasonDetail: trust,
    }
  }

  if (isAdverse) {
    return {
      primaryReasonType: "adverse_registry_status",
      primaryReasonDetail: extractAdverseDetail(trust, confReasons),
    }
  }

  return {
    primaryReasonType:
      check.recommendedAction === "capture"
        ? "clean_approval"
        : "insufficient_confidence",
    primaryReasonDetail: trust || policy || "TrustGate decision applied",
  }
}

export function buildExplanationSellerFacts(
  check: SellerTrustCheck
): ExplanationSellerFacts {
  const { primaryReasonType, primaryReasonDetail } = classifyPrimaryReason(check)

  return {
    name: check.sellerName,
    price: check.amount,
    action: mapAction(check.recommendedAction),
    primaryReasonType,
    primaryReasonDetail,
    riskScore: check.riskScore,
    effectiveScore: check.effectiveScore,
    confidenceLevel: check.confidenceLevel ?? 0,
  }
}

export function formatSellerExplanationSentence(
  seller: ExplanationSellerFacts
): string {
  const verb =
    seller.action === "approve"
      ? "approved"
      : seller.action === "hold"
        ? "held"
        : "refused"

  return `${seller.name} was ${verb}: ${seller.primaryReasonDetail}`
}

export function resolveExplanationSellers(
  sellerName: string,
  comparison: SellerTrustCheck[],
  fallbackCheck: SellerTrustCheck
): {
  chosenSeller: ExplanationSellerFacts
  sellers: ExplanationSellerFacts[]
} {
  const sellers = comparison.map(buildExplanationSellerFacts)
  const existing = sellers.find((s) => s.name === sellerName)
  if (existing) {
    return { chosenSeller: existing, sellers }
  }

  const chosenSeller = buildExplanationSellerFacts(fallbackCheck)
  sellers.push(chosenSeller)
  return { chosenSeller, sellers }
}

export function buildDeterministicExplanation(
  chosenName: string,
  sellers: ExplanationSellerFacts[]
): string {
  const chosen = sellers.find((s) => s.name === chosenName)
  if (!chosen) return "Decision processed."

  const chosenSentence = formatSellerExplanationSentence(chosen)
  const others = sellers.filter((s) => s.name !== chosen.name)

  if (others.length === 0) {
    return chosenSentence
  }

  const altSentences = others.map(formatSellerExplanationSentence).join(" ")
  return `${chosenSentence} Alternatives: ${altSentences}`
}

/** Reject LLM text that swaps confidence/risk numbers across sellers. */
export function validateExplanationText(
  text: string,
  sellers: ExplanationSellerFacts[]
): boolean {
  const refused = sellers.filter((s) => s.action === "refuse")

  for (const seller of refused) {
    if (seller.primaryReasonType === "adverse_registry_status") {
      const detailLower = seller.primaryReasonDetail.toLowerCase()
      const hasAdverseCue =
        /cirp|adverse|elevated registry|under liquidation|struck off|not active/i.test(
          text
        ) && /cirp|adverse|registry|mca status/i.test(detailLower + text)
      if (!hasAdverseCue) return false
    }

    for (const other of sellers) {
      if (other.name === seller.name) continue

      if (other.confidenceLevel > 0) {
        const confStr = String(other.confidenceLevel)
        const nameIdx = text.toLowerCase().indexOf(seller.name.toLowerCase())
        if (nameIdx === -1) continue

        const window = text.slice(nameIdx, nameIdx + seller.name.length + 120)
        const blamesConfidence =
          new RegExp(
            `(scoring|risk signals?|confidence)\\s*${confStr}\\b`,
            "i"
          ).test(window) ||
          new RegExp(`\\b${confStr}\\s*%`, "i").test(window)

        if (blamesConfidence) return false
      }
    }
  }

  return true
}

export const EXPLANATION_SYSTEM_PROMPT = `You explain TrustGate payment decisions in 2-4 short sentences.

You receive a JSON payload with:
- chosenSeller: the selected merchant
- sellers: pre-labeled facts for EVERY evaluated candidate

Rules (strict):
- For each seller you mention, state ONLY that seller's own primaryReasonDetail as the cause of its decision.
- Never substitute one seller's confidenceLevel or riskScore as another seller's reason.
- Never invent a numeric justification not present in that specific seller's data.
- adverse_registry_status → cite the registry detail (e.g. CIRP), not a confidence percentage.
- insufficient_confidence → say insufficient verifiable history; do not call it "bad risk signals".
- Use ₹ for amounts. Separate confidence (registry verification) from risk signals (transaction history) when both appear for the same seller only.`
