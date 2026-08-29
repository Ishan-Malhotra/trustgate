"use client";

import { useEffect, useRef } from "react";
import type { AuditEntry } from "@/lib/types";

interface AuditLogPanelProps {
  entries: AuditEntry[];
  loading?: boolean;
}

const TYPE_STYLES: Record<AuditEntry["type"], string> = {
  trust_check: "text-blue-400",
  policy_check: "text-purple-400",
  payment: "text-emerald-400",
  refusal: "text-red-400",
  error: "text-orange-400",
  agent: "text-zinc-300",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AuditLogPanel({ entries, loading }: AuditLogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Audit Log
        </h2>
        {loading && (
          <span className="text-xs text-zinc-500 animate-pulse">Updating…</span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto font-mono text-xs">
        {entries.length === 0 ? (
          <p className="text-zinc-600">
            No events yet. Send a purchase request to see trust checks, policy
            gates, and payment actions.
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-zinc-600">
                <span>{formatTime(entry.timestamp)}</span>
                <span className={TYPE_STYLES[entry.type]}>[{entry.type}]</span>
              </div>
              <p className="mt-1 text-zinc-300">{entry.message}</p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
