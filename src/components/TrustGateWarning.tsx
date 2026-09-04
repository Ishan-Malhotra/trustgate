"use client"

interface TrustGateWarningProps {
  level: "caution" | "unreliable"
  message: string
  details?: string[]
}

export function TrustGateWarning({
  level,
  message,
  details = [],
}: TrustGateWarningProps) {
  const border =
    level === "unreliable"
      ? "border-amber-500/50 bg-amber-950/40"
      : "border-cyan-500/40 bg-zinc-950/90"
  const title =
    level === "unreliable"
      ? "TrustGate intervening — shopping source unreliable"
      : "TrustGate intervening"

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${border}`}
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/90">
        {title}
      </p>
      <p className="mt-1 text-sm text-zinc-200">{message}</p>
      {details.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-[11px] text-zinc-400">
          {details.map((d) => (
            <li key={d.slice(0, 80)}>{d}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] font-medium text-zinc-500">
        Unsafe proposals blocked — ₹0 sent to Razorpay for refused items.
      </p>
    </div>
  )
}
