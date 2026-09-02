"use client"

import { useEffect, useRef } from "react"
import type { AuditEntry } from "@/lib/types"
import { formatProgressEntry } from "@/lib/ui/progressLog"

interface EvaluationProgressProps {
  entries: AuditEntry[]
  active: boolean
  title?: string
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function EvaluationProgress({
  entries,
  active,
  title = "Evaluating…",
}: EvaluationProgressProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [entries.length])

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full rounded-xl border border-cyan-500/30 bg-zinc-950/80 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              active ? "animate-pulse bg-cyan-400" : "bg-zinc-600"
            }`}
            aria-hidden
          />
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400/90">
            {title}
          </p>
        </div>
        <div
          className="max-h-48 space-y-1.5 overflow-y-auto font-mono text-[11px]"
          aria-live="polite"
          aria-busy={active}
        >
          {entries.length === 0 ? (
            <p className="text-zinc-500">Starting agent…</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex gap-2 text-zinc-400">
                <span className="shrink-0 text-zinc-600">
                  {formatTime(entry.timestamp)}
                </span>
                <span className="whitespace-pre-wrap text-zinc-300">
                  {formatProgressEntry(entry)}
                </span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
