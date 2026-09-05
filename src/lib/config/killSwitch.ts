import { logAudit } from "@/lib/audit/logger"
import { getKillSwitchStore } from "@/lib/config/killSwitchStore"

export const KILL_SWITCH_MESSAGE =
  "Kill switch engaged: all autonomous payments are disabled. No agent will run purchases and ₹0 will be sent to Razorpay until you re-enable payments."

/**
 * Safety-critical: always read the shared store. Do not cache the flag
 * in-process — Fluid Compute instances must see each other's toggles.
 */
export async function isPaymentsKilled(): Promise<boolean> {
  return getKillSwitchStore().get()
}

export async function setPaymentsKilled(killed: boolean): Promise<boolean> {
  const store = getKillSwitchStore()
  const prev = await store.get()
  await store.set(killed)
  const next = await store.get()

  if (killed && !prev) {
    logAudit(
      "refusal",
      "[kill-switch] ENGAGED — autonomous payments disabled. Agents stopped.",
      { paymentsEnabled: false, backend: store.backend }
    )
  } else if (!killed && prev) {
    logAudit(
      "agent",
      "[kill-switch] RELEASED — autonomous payments re-enabled.",
      { paymentsEnabled: true, backend: store.backend }
    )
  }

  return next
}

export async function assertPaymentsAllowed(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!(await isPaymentsKilled())) return { ok: true }
  return { ok: false, error: KILL_SWITCH_MESSAGE }
}
