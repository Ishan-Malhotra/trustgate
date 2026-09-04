import { logAudit } from "@/lib/audit/logger"

const globalForKillSwitch = globalThis as unknown as {
  trustgatePaymentsKilled?: boolean
}

export const KILL_SWITCH_MESSAGE =
  "Kill switch engaged: all autonomous payments are disabled. No agent will run purchases and ₹0 will be sent to Razorpay until you re-enable payments."

export function isPaymentsKilled(): boolean {
  return Boolean(globalForKillSwitch.trustgatePaymentsKilled)
}

export function setPaymentsKilled(killed: boolean): boolean {
  const prev = isPaymentsKilled()
  globalForKillSwitch.trustgatePaymentsKilled = killed

  if (killed && !prev) {
    logAudit(
      "refusal",
      "[kill-switch] ENGAGED — autonomous payments disabled. Agents stopped.",
      { paymentsEnabled: false }
    )
  } else if (!killed && prev) {
    logAudit(
      "agent",
      "[kill-switch] RELEASED — autonomous payments re-enabled.",
      { paymentsEnabled: true }
    )
  }

  return isPaymentsKilled()
}

export function assertPaymentsAllowed(): {
  ok: true
} | {
  ok: false
  error: string
} {
  if (!isPaymentsKilled()) return { ok: true }
  return { ok: false, error: KILL_SWITCH_MESSAGE }
}
