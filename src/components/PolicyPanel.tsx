"use client";

import { useState } from "react";
import type { UserPolicy } from "@/lib/types";
import { TRUST_SPEND_LIMITS } from "@/lib/trust/trustSpendLimits";
import { formatInr } from "@/lib/ui/types";

interface PolicyPanelProps {
  policy: UserPolicy;
  onPolicyChange: (policy: UserPolicy) => void;
  onReset: () => void;
}

type PolicyField = keyof UserPolicy;

const FIELDS: Array<{
  key: PolicyField;
  label: string;
  hint: string;
  prefix?: string;
  suffix?: string;
  min: number;
  step: number;
}> = [
  {
    key: "max_spend_per_transaction",
    label: "Max per transaction",
    hint: "Hard refuse — no Razorpay call if a single payment exceeds this",
    prefix: "₹",
    min: 1,
    step: 100,
  },
  {
    key: "max_spend_per_seller",
    label: "Max per seller",
    hint: "Hard refuse — blocks any one seller above this amount",
    prefix: "₹",
    min: 1,
    step: 100,
  },
  {
    key: "confirm_above_amount",
    label: "Confirm above",
    hint: "Downgrades an approve to hold — money authorized, not captured",
    prefix: "₹",
    min: 1,
    step: 50,
  },
  {
    key: "hold_expiry_seconds",
    label: "Hold expiry",
    hint: "How long a held authorization waits before auto-resolving",
    suffix: "min",
    min: 1,
    step: 5,
  },
];

const TRUST_ENGINE_ROWS: Array<{ label: string; value: string; hint: string }> =
  [
    {
      label: "Live trial cap",
      value: formatInr(TRUST_SPEND_LIMITS.liveTrialLimit),
      hint: "Low-confidence / unverified merchants",
    },
    {
      label: "Medium floor / cap",
      value: `${formatInr(TRUST_SPEND_LIMITS.mediumFloor)} – ${formatInr(TRUST_SPEND_LIMITS.mediumCap)}`,
      hint: "Medium-tier bounds (+ medium-confidence ceiling)",
    },
    {
      label: "Medium formula",
      value: `${TRUST_SPEND_LIMITS.mediumBase} + (score − ${TRUST_SPEND_LIMITS.mediumScoreAnchor}) × ${TRUST_SPEND_LIMITS.mediumPerScorePoint}`,
      hint: "Rounded, then clamped to floor/cap",
    },
    {
      label: "High base / strong",
      value: `${formatInr(TRUST_SPEND_LIMITS.highBaseLimit)} / ${formatInr(TRUST_SPEND_LIMITS.highStrongLimit)}`,
      hint: `Strong at score ≥ ${TRUST_SPEND_LIMITS.highStrongMinScore}`,
    },
    {
      label: "Unlimited at score",
      value: `≥ ${TRUST_SPEND_LIMITS.unlimitedMinScore}`,
      hint: "No trust spend ceiling (null limit)",
    },
  ];

export function PolicyPanel({
  policy,
  onPolicyChange,
  onReset,
}: PolicyPanelProps) {
  const [devMode, setDevMode] = useState(false);

  const handleFieldChange = (key: PolicyField, raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;

    const next = { ...policy };
    if (key === "hold_expiry_seconds") {
      next.hold_expiry_seconds = parsed * 60;
    } else {
      next[key] = parsed;
    }
    onPolicyChange(next);
  };

  const displayValue = (key: PolicyField): number => {
    if (key === "hold_expiry_seconds") {
      return Math.round(policy.hold_expiry_seconds / 60);
    }
    return policy[key];
  };

  const handleToggleDevMode = () => {
    setDevMode((prev) => !prev);
  };

  return (
    <section className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          User Policy
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleDevMode}
            aria-pressed={devMode}
            aria-label="Toggle developer mode to show trust engine spend limits"
            className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              devMode
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            Dev mode
          </button>
          <button
            type="button"
            onClick={onReset}
            aria-label="Reset policy to defaults"
            className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            Reset
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Your spending rules — a second gate after trust. Trust can still approve
        a seller; these limits can refuse or hold the payment anyway. Edits apply
        on the next request.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="text-xs text-zinc-400">{field.label}</span>
            <div className="relative mt-1">
              {field.prefix && (
                <span
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-sm text-zinc-500"
                  aria-hidden="true"
                >
                  {field.prefix}
                </span>
              )}
              <input
                type="number"
                min={field.min}
                step={field.step}
                value={displayValue(field.key)}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                aria-label={field.label}
                aria-describedby={`policy-hint-${field.key}`}
                className={`w-full rounded-lg border border-zinc-700 bg-zinc-950 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-cyan-500/60 ${
                  field.prefix
                    ? "pl-6 pr-2"
                    : field.suffix
                      ? "pl-2 pr-10"
                      : "px-2"
                }`}
              />
              {field.suffix && (
                <span
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wide text-zinc-500"
                  aria-hidden="true"
                >
                  {field.suffix}
                </span>
              )}
            </div>
            <span
              id={`policy-hint-${field.key}`}
              className="mt-1 block text-[10px] leading-snug text-zinc-600"
            >
              {field.hint}
            </span>
          </label>
        ))}
      </div>

      {devMode && (
        <div
          className="mt-4 border-t border-zinc-800 pt-3"
          role="region"
          aria-label="Trust engine spend limits (read-only)"
        >
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">
            Trust spend limits
          </h3>
          <p className="mb-3 text-[10px] leading-snug text-zinc-600">
            Engine constants — how the formula works. Read-only; not user
            settings.
          </p>
          <dl className="space-y-2">
            {TRUST_ENGINE_ROWS.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5"
              >
                <dt className="text-xs text-zinc-400">{row.label}</dt>
                <dd className="text-right font-mono text-xs text-zinc-200">
                  {row.value}
                </dd>
                <dd className="col-span-2 text-[10px] text-zinc-600">
                  {row.hint}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
