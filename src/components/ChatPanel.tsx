"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/ui/types";
import {
  actionColor,
  actionLabel,
  formatInr,
  tierColor,
} from "@/lib/ui/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  loadingLabel?: string;
  onSend: (message: string) => void;
  onQuickDemo: (message: string) => void;
}

const QUICK_DEMOS = [
  {
    label: "Cheapest banana bread",
    message: "Get the cheapest banana bread you can find",
  },
  {
    label: "Indian food, safely",
    message: "Order Indian food, cheapest option that's safe to buy from",
  },
  {
    label: "Phone case, best price",
    message: "Buy a phone case, best price",
  },
  {
    label: "Coffee tasting ~₹450",
    message: "Get me a coffee tasting, around ₹450",
  },
  {
    label: "Pay Infosys ₹250",
    message: "Pay Infosys Limited ₹250 for software consulting",
  },
  {
    label: "Buy white Star Wars t-shirt",
    message: "Buy a white Star Wars t-shirt",
  },
];

export function ChatPanel({
  messages,
  loading,
  loadingLabel = "Comparing relevant sellers…",
  onSend,
  onQuickDemo,
}: ChatPanelProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Purchase Request
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Describe a goal, not a seller — e.g. &quot;Get me the best banana bread
          you can find&quot;. Name a real company outside the catalog for live MCA
          lookup.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
            TrustGate compares relevant sellers on trust and price before any
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

              {msg.evaluatedSellers && msg.evaluatedSellers.length > 0 && (
                <div className="mt-3 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-xs">
                  <p className="font-semibold uppercase tracking-wider text-zinc-500">
                    Agent comparison
                  </p>
                  {msg.evaluatedSellers.map((check) => {
                    const chosen = check.sellerId === msg.chosenSellerId;
                    return (
                      <div
                        key={check.sellerId}
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
                          <span className="text-zinc-400">
                            {formatInr(check.amount)}
                          </span>
                        </div>
                        <p className="mt-1 text-zinc-400">
                          Trust{" "}
                          {check.riskScore !== undefined &&
                          check.riskScore !== check.score ? (
                            <>
                              <span className="text-zinc-500">
                                Raw {check.riskScore} ({check.riskTier})
                              </span>
                              {" → "}
                              <strong className={tierColor(check.tier)}>
                                {check.score} ({check.tier})
                              </strong>
                            </>
                          ) : (
                            <strong className={tierColor(check.tier)}>
                              {check.score} ({check.tier})
                            </strong>
                          )}
                          {" · "}
                          <span className={actionColor(check.recommendedAction)}>
                            {actionLabel(check.recommendedAction)}
                          </span>
                        </p>
                      </div>
                    );
                  })}
                  {msg.decision && (
                    <div className="flex flex-wrap gap-3 pt-1 text-zinc-400">
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
                  )}
                  {msg.explanation && (
                    <p className="mt-2 text-zinc-400">{msg.explanation}</p>
                  )}
                  {msg.payment && (
                    <p
                      className={`mt-2 ${
                        msg.payment.flagged
                          ? "text-orange-400"
                          : "text-zinc-400"
                      }`}
                    >
                      {msg.payment.flagged
                        ? `FLAGGED unresolved: ${String(msg.payment.error ?? "Razorpay failed after retry")}`
                        : `Payment ${String(msg.payment.status ?? msg.payment.action ?? "ok")}${
                            msg.payment.orderId
                              ? ` · order ${String(msg.payment.orderId)}`
                              : ""
                          }${
                            msg.payment.mode === "mock" ? " · mock" : ""
                          }`}
                    </p>
                  )}
                </div>
              )}
              {(!msg.evaluatedSellers || msg.evaluatedSellers.length === 0) &&
                (msg.decision || msg.payment) && (
                  <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-xs text-zinc-400">
                    {msg.decision && (
                      <p>
                        Action:{" "}
                        <strong className={actionColor(msg.decision.action)}>
                          {actionLabel(msg.decision.action)}
                        </strong>
                      </p>
                    )}
                    {msg.explanation && (
                      <p className="mt-2">{msg.explanation}</p>
                    )}
                  </div>
                )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-500">
              {loadingLabel}
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
              aria-label={demo.label}
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
            placeholder="Get me the best banana bread you can find"
            disabled={loading}
            aria-label="Purchase goal"
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
