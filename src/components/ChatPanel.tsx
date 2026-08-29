"use client";

import { useState } from "react";
import type { ChatMessage, ScoredSeller } from "@/lib/ui/types";
import {
  actionColor,
  actionLabel,
  formatInr,
  tierColor,
} from "@/lib/ui/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (message: string) => void;
  onQuickDemo: (message: string) => void;
  sellers: ScoredSeller[];
}

const QUICK_DEMOS = [
  {
    label: "Buy ₹250 — Blue Bottle",
    message: "Buy lunch for ₹250 from Blue Bottle Coffee",
  },
  {
    label: "Buy ₹500 — Blue Bottle (hold)",
    message: "Buy ₹500 from Blue Bottle Coffee",
  },
  {
    label: "Buy ₹200 — Gaming seller",
    message: "Buy ₹200 from DealDash Express",
  },
  {
    label: "Buy ₹150 — Bargain Bazaar",
    message: "Buy ₹150 from Bargain Bazaar",
  },
];

export function ChatPanel({
  messages,
  loading,
  onSend,
  onQuickDemo,
}: ChatPanelProps) {
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setInput("");
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Purchase Request
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Ask to buy from any seller, e.g. &quot;Buy ₹250 from Blue Bottle
          Coffee&quot;
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
            TrustGate evaluates seller trust and your spending policy before any
            payment moves.
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-blue-600/20 text-blue-100"
                  : "border border-zinc-800 bg-zinc-950/80 text-zinc-200"
              }`}
            >
              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>

              {msg.decision && (
                <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-xs">
                  <div className="flex flex-wrap gap-3">
                    <span>
                      Score:{" "}
                      <strong className={tierColor(msg.decision.tier)}>
                        {msg.decision.score}
                      </strong>
                    </span>
                    <span>
                      Tier:{" "}
                      <strong className={tierColor(msg.decision.tier)}>
                        {msg.decision.tier}
                      </strong>
                    </span>
                    <span>
                      Action:{" "}
                      <strong className={actionColor(msg.decision.action)}>
                        {actionLabel(msg.decision.action)}
                      </strong>
                    </span>
                    {msg.decision.spendLimit !== null && (
                      <span>Limit: {formatInr(msg.decision.spendLimit)}</span>
                    )}
                  </div>
                  {msg.explanation && (
                    <p className="mt-2 text-zinc-400">{msg.explanation}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-500">
              Evaluating trust and policy…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {QUICK_DEMOS.map((demo) => (
            <button
              key={demo.label}
              type="button"
              disabled={loading}
              onClick={() => onQuickDemo(demo.message)}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
            >
              {demo.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Buy ₹250 from Blue Bottle Coffee"
            disabled={loading}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
