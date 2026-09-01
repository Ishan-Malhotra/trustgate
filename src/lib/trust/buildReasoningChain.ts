import type { MCARecord } from "@/lib/registry/mcaLookup";
import type { ConfidenceResult } from "./confidence";
import type { FinalDecision, TrustScoreResult } from "@/lib/types";

export interface ReasoningStep {
  step: number;
  label: string;
  detail: string;
}

export function buildLiveLookupReasoningChain(input: {
  merchantName: string;
  amount: number;
  mcaRecord: MCARecord | null;
  confidence: ConfidenceResult;
  scoreResult: TrustScoreResult;
  finalDecision: FinalDecision;
}): ReasoningStep[] {
  const { merchantName, amount, mcaRecord, confidence, scoreResult, finalDecision } =
    input;
  const { breakdown } = scoreResult;
  const steps: ReasoningStep[] = [];

  if (mcaRecord) {
    steps.push({
      step: 1,
      label: "MCA registry lookup",
      detail: `Found ${mcaRecord.companyName} (CIN ${mcaRecord.cin}). Status: ${mcaRecord.status}. Registered ${mcaRecord.registrationDate ?? "unknown"}. Paid-up capital ₹${mcaRecord.paidupCapital.toLocaleString("en-IN")}. State: ${mcaRecord.state}.`,
    });
  } else {
    steps.push({
      step: 1,
      label: "MCA registry lookup",
      detail: `No match in MCA Company Master Data for "${merchantName}".`,
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

  steps.push({
    step: 3,
    label: "Risk scoring",
    detail: `Score ${scoreResult.score} (${scoreResult.tier} tier). ${historyNote} KYC/registry bonus +${breakdown.kycBonus}, age bonus +${breakdown.ageBonus}. Return penalty −${breakdown.returnPenalty}, volatility penalty −${breakdown.volatilityPenalty}.`,
  });

  const riskVsConfidence =
    confidence.band === "high" && !breakdown.transactionHistoryKnown
      ? "High registry confidence overrides medium risk tier caused solely by missing transaction history — not by bad signals."
      : confidence.band === "low"
        ? "Low confidence caps spend regardless of risk score — insufficient verifiable history."
        : confidence.adverseStatus || confidence.elevatedRisk
          ? "Adverse or elevated registry status drives refusal independent of confidence."
          : `Risk tier ${scoreResult.tier} combined with ${confidence.band} confidence.`;

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
