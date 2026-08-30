"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { SellerPanel } from "@/components/SellerPanel";
import { PolicyPanel } from "@/components/PolicyPanel";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import type { AuditEntry, UserPolicy } from "@/lib/types";
import type {
  ChatMessage,
  PurchaseResponse,
  ScoredSeller,
  SellersResponse,
} from "@/lib/ui/types";
import { parsePurchaseMessage } from "@/lib/ui/types";
import { USER_POLICY } from "@/lib/config/userPolicy";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TrustGateApp() {
  const [sellers, setSellers] = useState<ScoredSeller[]>([]);
  const [userPolicy, setUserPolicy] = useState<UserPolicy>(USER_POLICY);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [workspaceConfigured, setWorkspaceConfigured] = useState(false);
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [bootError, setBootError] = useState<string>();

  const fetchSellers = useCallback(async () => {
    const res = await fetch("/api/sellers");
    if (!res.ok) throw new Error("Failed to load sellers");
    const data: SellersResponse = await res.json();
    setSellers(data.sellers);
    setUserPolicy(data.userPolicy);
    setLlmConfigured(Boolean(data.llmConfigured));
    setWorkspaceConfigured(Boolean(data.anthropicWorkspaceConfigured));
    setRazorpayConfigured(Boolean(data.razorpayConfigured));
  }, []);

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
    fetchSellers().catch((err) =>
      setBootError(err instanceof Error ? err.message : "Boot failed")
    );
    fetchAuditLog();
  }, [fetchSellers, fetchAuditLog]);

  async function runPurchase(message: string): Promise<PurchaseResponse> {
    const res = await fetch("/api/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
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
      const parsed = parsePurchaseMessage(message, sellers);
      if (parsed.sellerId) setSelectedSellerId(parsed.sellerId);

      const agentResult = await runPurchase(message);
      const decision = agentResult.decision;
      const explanation = agentResult.explanation;
      const payment = agentResult.payment;
      const assistantContent =
        agentResult.explanation ??
        agentResult.response ??
        "Request processed.";
      if (agentResult.auditLog) setAuditLog(agentResult.auditLog);

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: assistantContent,
          decision,
          explanation,
          payment,
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

  function handleSelectSeller(seller: ScoredSeller) {
    setSelectedSellerId(seller.id);
    const message = `Buy ₹250 from ${seller.name}`;
    void handleMessage(message);
  }

  if (bootError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-red-400">
        {bootError}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6">
      <header className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          TrustGate
        </h1>
        <p className="text-sm text-zinc-500">
          AI buyer-agent — trust score + user policy before payment
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Agent:{" "}
          <span
            className={
              llmConfigured && workspaceConfigured
                ? "text-emerald-400"
                : "text-amber-400"
            }
          >
            {!llmConfigured
              ? "missing ANTHROPIC_API_KEY"
              : workspaceConfigured
                ? "Anthropic ready"
                : "add ANTHROPIC_WORKSPACE_ID (wrkspc_…)"}
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

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-5">
        <div className="flex min-h-[480px] flex-col lg:col-span-3 lg:min-h-0">
          <ChatPanel
            messages={messages}
            loading={loading}
            onSend={handleMessage}
            onQuickDemo={handleMessage}
            sellers={sellers}
          />
        </div>

        <div className="flex min-h-0 flex-col gap-4 lg:col-span-2">
          <PolicyPanel policy={userPolicy} />
          <SellerPanel
            sellers={sellers}
            selectedSellerId={selectedSellerId}
            onSelectSeller={handleSelectSeller}
          />
          <AuditLogPanel entries={auditLog} loading={logLoading} />
        </div>
      </div>
    </div>
  );
}
