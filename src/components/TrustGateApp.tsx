"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { PolicyPanel } from "@/components/PolicyPanel";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { ControlGate } from "@/components/ControlGate";
import type { AuditEntry, UserPolicy } from "@/lib/types";
import type {
  ChatMessage,
  PurchaseResponse,
  SellersResponse,
} from "@/lib/ui/types";
import { USER_POLICY } from "@/lib/config/userPolicy";
import { filterProgressEntries } from "@/lib/ui/progressLog";

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
  const [userPolicy, setUserPolicy] = useState<UserPolicy>(USER_POLICY);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(
    "Comparing relevant sellers…"
  );
  const [progressEntries, setProgressEntries] = useState<AuditEntry[]>([]);
  const progressBaselineRef = useRef(0);
  const [logLoading, setLogLoading] = useState(false);
  const [logClearing, setLogClearing] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [paymentsKilled, setPaymentsKilled] = useState(false);
  const [bootError, setBootError] = useState<string>();
  const [killSwitchBusy, setKillSwitchBusy] = useState(false);
  const [controlMode, setControlMode] = useState<
    "checking" | "open" | "password" | "locked"
  >("checking");
  const [unlocked, setUnlocked] = useState(false);

  const fetchBootConfig = useCallback(
    async (options?: { syncPolicy?: boolean }) => {
      const res = await fetch("/api/sellers");
      if (!res.ok) throw new Error("Failed to load app config");
      const data: SellersResponse = await res.json();
      if (options?.syncPolicy) {
        setUserPolicy(data.userPolicy);
      }
      setLlmConfigured(Boolean(data.llmConfigured));
      setPaymentsKilled(Boolean(data.paymentsKilled));
    },
    []
  );

  const fetchAuditLog = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLogLoading(true);
    try {
      const res = await fetch("/api/audit-log");
      if (!res.ok) return;
      const data = await res.json();
      const entries = (data.entries ?? []) as AuditEntry[];
      setAuditLog(entries);
      return entries;
    } finally {
      if (!options?.silent) setLogLoading(false);
    }
  }, []);

  const handleClearAuditLog = useCallback(async () => {
    setLogClearing(true);
    try {
      const res = await fetch("/api/audit-log", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear audit log");
      setAuditLog([]);
      setProgressEntries([]);
      progressBaselineRef.current = 0;
    } catch (err) {
      setBootError(
        err instanceof Error ? err.message : "Failed to clear audit log"
      );
    } finally {
      setLogClearing(false);
    }
  }, []);

  useEffect(() => {
    if (!loading) return;

    const poll = async () => {
      const entries = await fetchAuditLog({ silent: true });
      if (!entries) return;
      const baseline = progressBaselineRef.current;
      const slice = entries.slice(baseline);
      setProgressEntries(filterProgressEntries(slice));
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 800);

    return () => window.clearInterval(id);
  }, [loading, fetchAuditLog]);

  useEffect(() => {
    let cancelled = false;
    const loadControl = async () => {
      try {
        const res = await fetch("/api/auth");
        const data = await res.json();
        if (cancelled) return;
        const mode =
          data.mode === "password" || data.mode === "locked"
            ? data.mode
            : "open";
        setControlMode(mode);
        if (mode === "open" || data.unlocked) {
          setUnlocked(true);
        }
      } catch (err) {
        if (!cancelled) {
          setBootError(
            err instanceof Error ? err.message : "Failed to check access"
          );
        }
      }
    };
    void loadControl();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    fetchBootConfig({ syncPolicy: true }).catch((err) =>
      setBootError(err instanceof Error ? err.message : "Boot failed")
    );
    fetchAuditLog();
  }, [unlocked, fetchBootConfig, fetchAuditLog]);

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

  const handleToggleKillSwitch = async () => {
    const next = !paymentsKilled;
    setKillSwitchBusy(true);
    try {
      const res = await fetch("/api/kill-switch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ killed: next }),
      });
      if (!res.ok) throw new Error("Kill switch update failed");
      const data = await res.json();
      setPaymentsKilled(Boolean(data.paymentsKilled));
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: next
            ? "Kill switch engaged. All autonomous payments are disabled — agents will not run purchases and ₹0 will go to Razorpay until you re-enable."
            : "Kill switch released. Autonomous payments are enabled again.",
        },
      ]);
      await fetchAuditLog({ silent: true });
    } catch (err) {
      setBootError(
        err instanceof Error ? err.message : "Kill switch update failed"
      );
    } finally {
      setKillSwitchBusy(false);
    }
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

  function resolveLoadingLabel(message: string): string {
    const lower = message.toLowerCase();
    const isCatalogSearch =
      lower.includes("star wars") ||
      lower.includes("t-shirt") ||
      lower.includes("tshirt");
    if (isCatalogSearch) {
      return "Searching catalog + verifying with TrustGate…";
    }
    return "Comparing relevant sellers…";
  }

  async function handleMessage(message: string) {
    setLoadingLabel(resolveLoadingLabel(message));
    progressBaselineRef.current = auditLog.length;
    setProgressEntries([]);
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
      setProgressEntries([]);
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

  if (controlMode === "checking") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-zinc-500">
        Checking access…
      </div>
    );
  }

  if (controlMode === "locked" || (controlMode === "password" && !unlocked)) {
    return (
      <ControlGate
        mode={controlMode === "locked" ? "locked" : "password"}
        onUnlocked={() => {
          setUnlocked(true);
          setControlMode("password");
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
      <header className="shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              TrustGate
            </h1>
            <p className="text-sm text-zinc-500">
              Authorization layer for autonomous commerce.
            </p>
            <p
              className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-400"
              aria-live="polite"
            >
              <span
                className={
                  llmConfigured ? "text-zinc-400" : "text-amber-400"
                }
              >
                {llmConfigured ? "Agent connected" : "Agent offline"}
              </span>
              <span className="text-zinc-600" aria-hidden="true">
                •
              </span>
              <span
                className={
                  paymentsKilled ? "text-red-400" : "text-zinc-400"
                }
              >
                {paymentsKilled
                  ? "Payment gate halted"
                  : "Payment gate active"}
              </span>
              <span className="text-zinc-600" aria-hidden="true">
                •
              </span>
              <span
                className={`inline-flex items-center gap-1.5 ${
                  paymentsKilled ? "text-red-400" : "text-emerald-400"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    paymentsKilled ? "bg-red-400" : "bg-emerald-400"
                  }`}
                  aria-hidden="true"
                />
                {paymentsKilled ? "Unprotected" : "Protected"}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleToggleKillSwitch()}
            disabled={killSwitchBusy || loading}
            aria-pressed={paymentsKilled}
            aria-label={
              paymentsKilled
                ? "Re-enable autonomous payments"
                : "Engage kill switch — disable all autonomous payments"
            }
            className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 ${
              paymentsKilled
                ? "border-emerald-600/60 bg-emerald-950/50 text-emerald-300 hover:border-emerald-500"
                : "border-red-600/70 bg-red-950/60 text-red-200 hover:border-red-500 hover:bg-red-900/50"
            }`}
          >
            {paymentsKilled ? "Resume payments" : "Stop all payments"}
          </button>
        </div>
        {paymentsKilled && (
          <p
            className="mt-3 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200"
            role="status"
            aria-live="polite"
          >
            Kill switch engaged — autonomous agents and Razorpay calls are
            blocked. ₹0 will move until you resume payments.
          </p>
        )}
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-5">
        <div className="flex min-h-0 flex-col overflow-hidden lg:col-span-3">
          <ChatPanel
            messages={messages}
            loading={loading}
            loadingLabel={loadingLabel}
            progressEntries={progressEntries}
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
          <AuditLogPanel
            entries={auditLog}
            loading={logLoading}
            clearing={logClearing}
            onClear={() => void handleClearAuditLog()}
          />
        </div>
      </div>
    </div>
  );
}
