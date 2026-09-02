"use client"

import type { SellerTrustCheck } from "@/lib/types"
import { actionColor, actionLabel, formatInr } from "@/lib/ui/types"
import { buildTrustDisplayLines } from "@/lib/ui/trustDisplay"

interface SellerEvaluationSummaryProps {
  check: SellerTrustCheck
  chosen?: boolean
}

export function SellerEvaluationSummary({
  check,
  chosen = false,
}: SellerEvaluationSummaryProps) {
  const lines = buildTrustDisplayLines(check)

  return (
    <div
      className={`rounded-md border px-2 py-2 ${
        chosen
          ? "border-blue-500/40 bg-blue-500/10"
          : "border-zinc-800 bg-zinc-950/60"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-zinc-200">
          {check.sellerName}
          {chosen ? " · chosen" : ""}
        </span>
        <span className="text-zinc-400">{formatInr(check.amount)}</span>
      </div>
      <dl className="mt-2 space-y-1">
        {lines.map((line) => (
          <div key={line.label} className="flex flex-wrap gap-x-2 text-xs">
            <dt className="text-zinc-500">{line.label}:</dt>
            <dd className={line.className ?? "text-zinc-300"}>{line.value}</dd>
          </div>
        ))}
        <div className="flex flex-wrap gap-x-2 text-xs pt-0.5">
          <dt className="text-zinc-500">Decision:</dt>
          <dd className={actionColor(check.recommendedAction)}>
            {actionLabel(check.recommendedAction)}
          </dd>
        </div>
      </dl>
      {check.trustReason && (
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          {check.trustReason}
        </p>
      )}
    </div>
  )
}
