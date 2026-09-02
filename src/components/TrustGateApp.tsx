"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { SellerPanel } from "@/components/SellerPanel";
import { PolicyPanel } from "@/components/PolicyPanel";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import type { AuditEntry, SellerTrustCheck, UserPolicy } from "@/lib/types";
import type {
  CatalogSeller,
  ChatMessage,
  PurchaseResponse,
  SellersResponse,
} from "@/lib/ui/types";
import { USER_POLICY } from "@/lib/config/userPolicy";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function persistPolicy(policy: UserPolicy): Promise<UserPolicy> {
  const res = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policy),
  });
  if (!res.ok) throw new Error("Failed to save policy");
  const data = await res.json();
  return data.userPolicy as UserPolicy;
}

export function TrustGateApp() {
  const [sellers, setSellers] = useState<CatalogSeller[]>([]);
  const [userPolicy, setUserPolicy] = useState<UserPolicy>(USER_POLICY);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [revealedById, setRevealedById] = useState<
    Record<string, SellerTrustCheck>
  >({});
  const [chosenSellerId, setChosenSellerId] = useState<string>();
  const [devMode, setDevMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [bootError, setBootError] = useState<string>();

  const fetchSellers = useCallback(
    async (showScores: boolean, options?: { syncPolicy?: boolean }) => {
      const res = await fetch(
        showScores ? "/api/sellers?dev=1" : "/api/sellers"
      );
      if (!res.ok) throw new Error("Failed to load sellers");
      const data: SellersResponse = await res.json();
      setSellers(data.sellers);
      if (options?.syncPolicy) {
        setUserPolicy(data.userPolicy);
      }
      setLlmConfigured(Boolean(data.llmConfigured));
      setRazorpayConfigured(Boolean(data.razorpayConfigured));
    },
    []
  );

  const fetchAuditLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const res = await fetch("/api/audit-log");
      if (!res.ok) return;
      const data = await res.json();
      setAuditLog(data.entries ?? []);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSellers(false, { syncPolicy: true }).catch((err) =>
      setBootError(err instanceof Error ? err.message : "Boot failed")
    );
    fetchAuditLog();
  }, [fetchSellers, fetchAuditLog]);

  const handleToggleDevMode = () => {
    const next = !devMode;
    setDevMode(next);
    void fetchSellers(next).catch((err) =>
      setBootError(err instanceof Error ? err.message : "Failed to reload sellers")
    );
  };

  const handlePolicyChange = (policy: UserPolicy) => {
    setUserPolicy(policy);
    void persistPolicy(policy).catch(() => {
      /* local state still applies to next purchase body */
    });
  };

  const handlePolicyReset = () => {
    void fetch("/api/config", { method: "DELETE" })
      .then((res) => res.json())
      .then((data) => setUserPolicy(data.userPolicy as UserPolicy))
      .catch(() => setUserPolicy(USER_POLICY));
  };

  async function runPurchase(
    message: string,
    policy: UserPolicy
  ): Promise<PurchaseResponse> {
    const res = await fetch("/api/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, userPolicy: policy }),
    });
    if (!res.ok) throw new Error("Agent request failed");
    return res.json();
  }

  async function handleMessage(message: string) {
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", content: message },
    ]);

    try {
      const agentResult = await runPurchase(message, userPolicy);
      const decision = agentResult.decision;
      const explanation = agentResult.explanation;
      const payment = agentResult.payment;
      const evaluatedSellers = agentResult.evaluatedSellers ?? [];
      const nextChosen = agentResult.chosenSellerId;
      const assistantContent =
        agentResult.response ||
        agentResult.explanation ||
        "Request processed.";
      if (agentResult.auditLog) setAuditLog(agentResult.auditLog);

      const nextRevealed: Record<string, SellerTrustCheck> = {};
      for (const check of evaluatedSellers) {
        nextRevealed[check.sellerId] = check;
      }
      setRevealedById(nextRevealed);
      setChosenSellerId(nextChosen);

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: assistantContent,
          decision,
          explanation,
          payment,
          evaluatedSellers,
          chosenSellerId: nextChosen,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content:
            err instanceof Error ? err.message : "Something went wrong.",
        },
      ]);
    } finally {
      setLoading(false);
      fetchAuditLog();
    }
  }

  if (bootError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-red-400">
        {bootError}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
      <header className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          TrustGate
        </h1>
        <p className="text-sm text-zinc-500">
          AI buyer-agent — trust score + user policy before payment
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Agent:{" "}
          <span className={llmConfigured ? "text-emerald-400" : "text-amber-400"}>
            {llmConfigured ? "Anthropic ready" : "missing ANTHROPIC_API_KEY"}
          </span>
          {" · "}
          Razorpay:{" "}
          <span
            className={
              razorpayConfigured ? "text-emerald-400" : "text-zinc-500"
            }
          >
            {razorpayConfigured ? "test keys loaded" : "mock mode"}
          </span>
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-5">
        <div className="flex min-h-0 flex-col overflow-hidden lg:col-span-3">
          <ChatPanel
            messages={messages}
            loading={loading}
            onSend={handleMessage}
            onQuickDemo={handleMessage}
          />
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden lg:col-span-2">
          <PolicyPanel
            policy={userPolicy}
            onPolicyChange={handlePolicyChange}
            onReset={handlePolicyReset}
          />
          <div className="max-h-44 shrink-0 overflow-y-auto">
            <SellerPanel
              sellers={sellers}
              revealedById={revealedById}
              chosenSellerId={chosenSellerId}
              devMode={devMode}
              onToggleDevMode={handleToggleDevMode}
            />
          </div>
          <AuditLogPanel entries={auditLog} loading={logLoading} />
        </div>
      </div>
    </div>
  );
}
