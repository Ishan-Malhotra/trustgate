"use client";

import type { UserPolicy } from "@/lib/types";
import { formatInr } from "@/lib/ui/types";

interface PolicyPanelProps {
  policy: UserPolicy;
}

export function PolicyPanel({ policy }: PolicyPanelProps) {
  const items = [
    {
      label: "Max per transaction",
      value: formatInr(policy.max_spend_per_transaction),
    },
    {
      label: "Max per seller",
      value: formatInr(policy.max_spend_per_seller),
    },
    {
      label: "Confirm above",
      value: formatInr(policy.confirm_above_amount),
    },
    {
      label: "Hold expiry",
      value: `${policy.hold_expiry_seconds / 60} min`,
    },
  ];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        User Policy
      </h2>
      <p className="mb-3 text-xs text-zinc-500">
        Config in{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-400">
          src/lib/config/userPolicy.ts
        </code>
      </p>
      <dl className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-zinc-500">{item.label}</dt>
            <dd className="font-mono text-sm text-zinc-200">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
