import type { AgentProposal } from "@/lib/trustgate/agentProposal"
import type { ProductIntegrityResult } from "@/lib/catalog/types"

const STOP_WORDS = new Set([
  "buy", "me", "a", "an", "the", "for", "please", "get", "order", "want",
  "need", "some", "my", "to", "of", "and", "with", "around", "about", "from",
  "cheapest", "best", "white",
])

const ACCESSORY_PHRASES = [
  "controller cover", "lens cap", "lens cover", "phone case", "screen protector",
  "charging cable", "usb cable", "skin", "stand", "mount", "grip", "holder",
  "pouch", "sleeve", "adapter", "charger", "cover", "case", "cap", "strap", "remote",
]

const PRIMARY_REQUEST_MARKERS = [
  "ps5", "playstation", "xbox", "switch", "console", "camera", "phone",
  "iphone", "laptop", "macbook", "television", "tv", "monitor", "headphones", "earbuds",
]

const SYNONYMS: Record<string, string[]> = {
  ps5: ["ps5", "playstation5", "playstation", "sonyplaystation5"],
  playstation: ["ps5", "playstation5", "playstation", "sonyplaystation5"],
  camera: ["camera", "dslr", "mirrorless"],
  phone: ["phone", "smartphone", "mobile"],
  console: ["console", "ps5", "playstation5", "xbox"],
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

function compact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "")
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+$/.test(t))
}

function expandToken(token: string): Set<string> {
  const out = new Set<string>([token, compact(token)])
  const syns = SYNONYMS[token]
  if (syns) for (const s of syns) out.add(s)
  return out
}

function requestLooksPrimary(requestNorm: string): boolean {
  return PRIMARY_REQUEST_MARKERS.some(
    (m) => requestNorm.includes(m) || compact(requestNorm).includes(compact(m))
  )
}

function listingLooksAccessory(listingNorm: string): boolean {
  return ACCESSORY_PHRASES.some((p) => listingNorm.includes(p))
}

function hasPrimaryProductConfirmation(
  requestTokens: string[],
  listingNorm: string,
  listingCompact: string
): boolean {
  const wantsConsole = requestTokens.some((t) =>
    ["ps5", "playstation", "console", "xbox"].includes(t)
  )
  if (wantsConsole) {
    if (/\bconsole\b/.test(listingNorm)) return true
    if (/playstation\s*5/.test(listingNorm) && !listingLooksAccessory(listingNorm)) {
      return true
    }
    if (
      /\bps5\b/.test(listingNorm) &&
      !listingLooksAccessory(listingNorm) &&
      (listingNorm.includes("sony") || listingNorm.includes("console"))
    ) {
      return true
    }
    return false
  }

  const wantsCamera = requestTokens.includes("camera")
  if (wantsCamera) {
    if (listingLooksAccessory(listingNorm)) return false
    return /\bcamera\b/.test(listingNorm) || /\bdslr\b/.test(listingNorm)
  }

  for (const token of requestTokens) {
    const expanded = expandToken(token)
    let hit = false
    for (const e of expanded) {
      if (listingNorm.includes(e) || listingCompact.includes(compact(e))) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }
  return requestTokens.length > 0
}

export function checkProductIntegrity(
  userRequest: string,
  proposal: AgentProposal
): ProductIntegrityResult {
  const requested = userRequest.trim()
  const found = (proposal.productName ?? "").trim()

  if (!found) {
    return {
      match: false,
      requested,
      found: "(missing product title)",
      reason:
        "Product integrity refused: shopping proposal has no product title — fail closed.",
    }
  }

  const requestNorm = normalizeText(requested)
  const listingNorm = normalizeText(found)
  const listingCompact = compact(found)
  const requestTokens = tokens(requested)

  if (requestTokens.length === 0) {
    return {
      match: false,
      requested,
      found,
      reason:
        "Product integrity refused: could not extract a clear product intent from the user request.",
    }
  }

  if (requestLooksPrimary(requestNorm) && listingLooksAccessory(listingNorm)) {
    return {
      match: false,
      requested,
      found,
      reason: `Product mismatch: requested primary product ("${requested}") but found accessory/parts listing ("${found}").`,
    }
  }

  if (!hasPrimaryProductConfirmation(requestTokens, listingNorm, listingCompact)) {
    return {
      match: false,
      requested,
      found,
      reason: `Product mismatch: listing does not clearly match the requested product. Requested: ${requested}. Found: ${found}.`,
    }
  }

  return {
    match: true,
    requested,
    found,
    reason: `Product match: listing appears consistent with request ("${requested}" → "${found}").`,
  }
}
