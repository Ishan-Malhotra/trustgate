import type { AuditEntry } from "@/lib/types"

/** Human-readable steps shown while the agent is evaluating. */
export function isEvaluationProgressEntry(entry: AuditEntry): boolean {
  if (entry.type === "error" || entry.type === "flagged") return true
  if (entry.type === "trust_check" || entry.type === "policy_check") return true
  if (entry.type === "reasoning") return true
  if (entry.type === "agent") {
    if (entry.message.startsWith("User request:")) return true
    if (entry.message.includes("[search_catalog]")) return true
    if (entry.message.includes("[live-lookup]")) return true
    if (entry.message.includes("[gst]")) return true
    if (entry.message.startsWith("Tool call:")) return true
    if (entry.message.startsWith("Tool result:")) return false
    return entry.message.length < 280
  }
  return false
}

export function formatProgressEntry(entry: AuditEntry): string {
  const msg = entry.message
  if (msg.startsWith("User request:")) {
    return `Received: ${msg.slice("User request:".length).trim()}`
  }
  if (msg.startsWith("Tool call:")) {
    return msg.replace("Tool call:", "Calling")
  }
  if (msg.includes("[gst]")) {
    return msg.replace("[gst]", "GST:").trim()
  }
  if (msg.includes("[search_catalog]")) {
    return msg.replace("[search_catalog]", "Catalog:").trim()
  }
  if (msg.includes("[live-lookup]") && entry.type === "trust_check") {
    return msg.replace("[live-lookup]", "TrustGate:").trim()
  }
  if (msg.includes("[live-lookup]") && entry.type === "policy_check") {
    return msg.replace("[live-lookup]", "Policy:").trim()
  }
  if (entry.type === "policy_check") {
    return `Policy: ${msg}`.trim()
  }
  if (entry.type === "reasoning" && msg.startsWith("Agent conclusion")) {
    return "Agent reached a conclusion"
  }
  if (entry.type === "error") {
    return msg
  }
  return msg.length > 220 ? `${msg.slice(0, 217)}…` : msg
}

export function filterProgressEntries(entries: AuditEntry[]): AuditEntry[] {
  return entries.filter(isEvaluationProgressEntry)
}
