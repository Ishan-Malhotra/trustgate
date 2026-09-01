import type { MCARecord } from "@/lib/registry/mcaLookup";
import type { McaLookupResult } from "@/lib/registry/mcaLookup";
import type { ConfidenceResult } from "./confidence";
import type { FinalDecision } from "@/lib/types";

export interface ReasoningStep {
  step: number;
  label: string;
  detail: string;
}

export function buildLiveLookupReasoningChain(input: {
  merchantName: string;
  amount: number;
  mcaRecord: MCARecord | null;
  lookupResult?: McaLookupResult;
  confidence: ConfidenceResult;
  finalDecision: FinalDecision;
}): ReasoningStep[] {
  const {
    merchantName,
    amount,
    mcaRecord,
    lookupResult,
    confidence,
    finalDecision,
  } = input;
  const { breakdown, riskScore, riskTier, effectiveScore, effectiveTier } =
    finalDecision;
  const steps: ReasoningStep[] = [];

  if (mcaRecord) {
    steps.push({
      step: 1,
      label: "MCA registry lookup",
      detail: `Found ${mcaRecord.companyName} (CIN ${mcaRecord.cin}). Status: ${mcaRecord.status}. Registered ${mcaRecord.registrationDate ?? "unknown"}. Paid-up capital ₹${mcaRecord.paidupCapital.toLocaleString("en-IN")}. State: ${mcaRecord.state}.`,
    });
  } else {
    const failureReason = lookupResult?.failureReason;
    const failureDetail =
      failureReason === "timeout"
        ? "API timeout — could not reach MCA registry (not the same as 'company does not exist')."
        : failureReason === "api-error"
          ? "API error — registry lookup failed transiently (not the same as 'company does not exist')."
          : "No match in MCA Company Master Data — genuinely not found in registry.";
    steps.push({
      step: 1,
      label: "MCA registry lookup",
      detail: `${failureDetail} Query: "${merchantName}".`,
    });
  }

  steps.push({
    step: 2,
    label: "Confidence assessment",
    detail: `Band: ${confidence.band} (${confidence.level}%). ${confidence.reasons.join("; ")}.`,
  });

  const historyNote = breakdown.transactionHistoryKnown
    ? `Weighted dispute rate ${breakdown.weightedDisputeRate} → dispute score ${breakdown.disputeScore}.`
    : `No transaction history on file — dispute score capped at ${breakdown.disputeScore} (unknown, not clean).`;

  const scoreDetail =
    riskScore !== effectiveScore
      ? `Raw signal score ${riskScore} (${riskTier} tier). Effective score ${effectiveScore} (${effectiveTier} tier) after registry trust floor. ${historyNote} KYC/registry bonus +${breakdown.kycBonus}, age bonus +${breakdown.ageBonus}. Return penalty −${breakdown.returnPenalty}, volatility penalty −${breakdown.volatilityPenalty}, no-history penalty −${breakdown.noHistoryPenalty}.`
      : `Score ${effectiveScore} (${effectiveTier} tier). ${historyNote} KYC/registry bonus +${breakdown.kycBonus}, age bonus +${breakdown.ageBonus}. Return penalty −${breakdown.returnPenalty}, volatility penalty −${breakdown.volatilityPenalty}, no-history penalty −${breakdown.noHistoryPenalty}.`;

  steps.push({
    step: 3,
    label: "Risk scoring",
    detail: scoreDetail,
  });

  const riskVsConfidence =
    confidence.band === "high" && riskScore !== effectiveScore
      ? "High registry confidence raised effective tier — missing transaction history only, no bad signals."
      : confidence.band === "high" && !breakdown.transactionHistoryKnown
        ? "High registry confidence overrides low/medium risk tier caused solely by missing transaction history — not by bad signals."
        : confidence.band === "low"
          ? "Low confidence caps spend regardless of risk score — insufficient verifiable history."
          : confidence.adverseStatus || confidence.elevatedRisk
            ? "Adverse or elevated registry status drives refusal independent of confidence."
            : `Effective risk tier ${effectiveTier} combined with ${confidence.band} confidence.`;

  steps.push({
    step: 4,
    label: "Trust decision",
    detail: `${riskVsConfidence} Action: ${finalDecision.originalAction}. ${finalDecision.trustReason}`,
  });

  if (finalDecision.policyReason) {
    steps.push({
      step: 5,
      label: "User policy gate",
      detail: `${finalDecision.policyReason}. Final action: ${finalDecision.action} (was ${finalDecision.originalAction}).`,
    });
  } else {
    steps.push({
      step: 5,
      label: "User policy gate",
      detail: `Amount ₹${amount} within policy limits. Final action: ${finalDecision.action}.`,
    });
  }

  return steps;
}

export function formatReasoningChain(steps: ReasoningStep[]): string {
  return steps.map((s) => `${s.step}. ${s.label}: ${s.detail}`).join("\n");
}

export function formatScoreSummary(decision: {
  riskScore: number;
  riskTier: string;
  effectiveScore: number;
  effectiveTier: string;
}): string {
  if (decision.riskScore !== decision.effectiveScore) {
    return `Raw signal score: ${decision.riskScore} (${decision.riskTier}) — registry-verified, effective: ${decision.effectiveScore} (${decision.effectiveTier})`;
  }
  return `Score ${decision.effectiveScore} (${decision.effectiveTier})`;
}
