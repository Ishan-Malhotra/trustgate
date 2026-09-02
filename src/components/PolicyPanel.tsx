"use client";

import type { UserPolicy } from "@/lib/types";

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
  min: number;
  step: number;
}> = [
  {
    key: "max_spend_per_transaction",
    label: "Max per transaction",
    hint: "Hard cap per payment",
    min: 1,
    step: 100,
  },
  {
    key: "max_spend_per_seller",
    label: "Max per seller",
    hint: "Lifetime cap per merchant",
    min: 1,
    step: 100,
  },
  {
    key: "confirm_above_amount",
    label: "Confirm above",
    hint: "Hold above this amount",
    min: 1,
    step: 50,
  },
  {
    key: "hold_expiry_seconds",
    label: "Hold expiry (min)",
    hint: "Auto-resolve held payments",
    min: 1,
    step: 5,
  },
];

export function PolicyPanel({
  policy,
  onPolicyChange,
  onReset,
}: PolicyPanelProps) {
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

  return (
    <section className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          User Policy
        </h2>
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset policy to defaults"
          className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          Reset
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Edits apply immediately to the next purchase request.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="text-xs text-zinc-500">{field.label}</span>
            <input
              type="number"
              min={field.min}
              step={field.step}
              value={displayValue(field.key)}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              aria-label={field.label}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-cyan-500/60"
            />
            <span className="mt-0.5 block text-[10px] text-zinc-600">
              {field.hint}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
