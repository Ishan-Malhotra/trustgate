import type { PaymentAction, SellerTrustCheck } from "@/lib/types"

export type ExplanationAction = "approve" | "hold" | "refuse"

export type PrimaryReasonType =
  | "adverse_registry_status"
  | "insufficient_confidence"
  | "policy_threshold"
  | "clean_approval"

export interface ExplanationReason {
  type: PrimaryReasonType
  detail: string
}

export interface ExplanationSellerFacts {
  name: string
  price: number
  action: ExplanationAction
  /** First reason — same order as `reasons[0]` (backward compatible). */
  primaryReasonType: PrimaryReasonType
  primaryReasonDetail: string
  /** All applicable reasons in display priority: trust/confidence before policy. */
  reasons: ExplanationReason[]
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

function isAdverseRegistry(check: SellerTrustCheck): boolean {
  const trust = check.trustReason ?? ""
  const confReasons = check.confidenceReasons ?? []
  return (
    /adverse mca|elevated registry risk|cirp|struck off|under liquidation|dissolved/i.test(
      trust
    ) ||
    confReasons.some((r) =>
      /adverse|cirp|struck off|liquidation|not active/i.test(r)
    )
  )
}

function isInsufficientConfidence(check: SellerTrustCheck): boolean {
  const trust = check.trustReason ?? ""
  return (
    /insufficient verifiable history|not found in mca|trial spend capped/i.test(
      trust
    ) ||
    (Boolean(check.liveLookup) &&
      check.confidenceBand === "low" &&
      check.recommendedAction !== "refuse")
  )
}

function isPolicyThreshold(check: SellerTrustCheck): boolean {
  const policy = check.policyReason ?? ""
  return Boolean(policy && /exceeds|threshold|max spend/i.test(policy))
}

/**
 * Ordered reasons for one seller: trust/confidence signals before policy.
 * Matches comparison-card priority (registry/confidence first, then policy).
 */
export function classifySellerReasons(
  check: SellerTrustCheck
): ExplanationReason[] {
  const trust = check.trustReason ?? ""
  const policy = check.policyReason ?? ""
  const confReasons = check.confidenceReasons ?? []
  const reasons: ExplanationReason[] = []

  if (isAdverseRegistry(check)) {
    reasons.push({
      type: "adverse_registry_status",
      detail: extractAdverseDetail(trust, confReasons),
    })
  }

  if (isInsufficientConfidence(check) && !isAdverseRegistry(check)) {
    reasons.push({
      type: "insufficient_confidence",
      detail: confReasons[0] ?? trust,
    })
  } else if (
    isInsufficientConfidence(check) &&
    isAdverseRegistry(check) &&
    /insufficient verifiable history/i.test(trust)
  ) {
    // Rare: keep confidence note after adverse if both genuinely appear
    reasons.push({
      type: "insufficient_confidence",
      detail: confReasons[0] ?? trust,
    })
  }

  if (isPolicyThreshold(check)) {
    reasons.push({
      type: "policy_threshold",
      detail: policy,
    })
  }

  if (reasons.length === 0) {
    if (check.recommendedAction === "capture") {
      reasons.push({ type: "clean_approval", detail: trust || "Approved" })
    } else {
      reasons.push({
        type: "insufficient_confidence",
        detail: trust || policy || "TrustGate decision applied",
      })
    }
  }

  return reasons
}

export function classifyPrimaryReason(check: SellerTrustCheck): {
  primaryReasonType: PrimaryReasonType
  primaryReasonDetail: string
  reasons: ExplanationReason[]
} {
  const reasons = classifySellerReasons(check)
  return {
    primaryReasonType: reasons[0].type,
    primaryReasonDetail: reasons[0].detail,
    reasons,
  }
}

export function buildExplanationSellerFacts(
  check: SellerTrustCheck
): ExplanationSellerFacts {
  const { primaryReasonType, primaryReasonDetail, reasons } =
    classifyPrimaryReason(check)

  return {
    name: check.sellerName,
    price: check.amount,
    action: mapAction(check.recommendedAction),
    primaryReasonType,
    primaryReasonDetail,
    reasons,
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

  const details = seller.reasons.map((r) => r.detail)
  const reasonText =
    details.length <= 1
      ? details[0] ?? seller.primaryReasonDetail
      : `${details[0]}; also ${details.slice(1).join("; also ")}`

  return `${seller.name} was ${verb}: ${reasonText}`
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

  // Multi-reason sellers: if prose mentions them with a policy cue, also require
  // the trust/confidence cue when both reason types are present.
  for (const seller of sellers) {
    const hasConfidence = seller.reasons.some(
      (r) =>
        r.type === "insufficient_confidence" ||
        r.type === "adverse_registry_status"
    )
    const hasPolicy = seller.reasons.some((r) => r.type === "policy_threshold")
    if (!hasConfidence || !hasPolicy) continue

    const nameIdx = text.toLowerCase().indexOf(seller.name.toLowerCase())
    if (nameIdx === -1) continue
    const window = text.slice(nameIdx, nameIdx + seller.name.length + 220)
    const mentionsPolicy = /exceeds|policy|threshold|₹\s*\d/i.test(window)
    const mentionsTrust =
      /insufficient|verifiable|history|confidence|cirp|adverse|registry|mca/i.test(
        window
      )
    if (mentionsPolicy && !mentionsTrust) return false
  }

  return true
}

export const EXPLANATION_SYSTEM_PROMPT = `You explain TrustGate payment decisions in 2-4 short sentences.

You receive a JSON payload with:
- chosenSeller: the selected merchant
- sellers: pre-labeled facts for EVERY evaluated candidate

Each seller has a \`reasons\` array (ordered). primaryReasonDetail is only the first entry.

Rules (strict):
- List every reason in the \`reasons\` array for this seller, in the order given. Do not omit any. Do not substitute a reason from a different seller.
- Prefer phrasing like: "held: <reason1>; also <reason2>" when multiple reasons exist.
- Never substitute one seller's confidenceLevel or riskScore as another seller's reason.
- Never invent a numeric justification not present in that specific seller's data.
- adverse_registry_status → cite the registry detail (e.g. CIRP), not a confidence percentage.
- insufficient_confidence → say insufficient verifiable history; do not call it "bad risk signals".
- policy_threshold → cite the user policy confirmation / spend limit reason.
- Use ₹ for amounts. Separate confidence (registry verification) from risk signals (transaction history) when both appear for the same seller only.`
