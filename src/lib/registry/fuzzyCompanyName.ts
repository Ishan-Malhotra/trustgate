/**
 * Fuzzy company-name helpers for MCA lookup.
 * API filters are still exact — we generate normalized query variants and
 * only accept returned records that score high enough vs the original query.
 */

const LEGAL_SUFFIXES = [
  "PRIVATE LIMITED",
  "PVT LTD",
  "PVT. LTD.",
  "PVT.LTD.",
  "PVT LTD.",
  "LIMITED",
  "LTD",
  "LLP",
  "OPC PRIVATE LIMITED",
  "OPC PVT LTD",
  "(OPC) PRIVATE LIMITED",
  "OPC",
] as const

const NOISE_TOKENS = new Set([
  "THE",
  "AND",
  "OF",
  "CO",
  "CO.",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "INDIA",
  "INDIAN",
])

/** Minimum similarity to accept a fuzzy MCA hit (fail closed below this). */
export const FUZZY_MCA_MIN_SCORE = 0.72

export function normalizeAggressive(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function stripLegalSuffix(name: string): string {
  let core = normalizeAggressive(name)
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of LEGAL_SUFFIXES) {
      const normalizedSuffix = normalizeAggressive(suffix)
      if (core.endsWith(` ${normalizedSuffix}`)) {
        core = core.slice(0, -(normalizedSuffix.length + 1)).trim()
        changed = true
        break
      }
      if (core === normalizedSuffix) {
        core = ""
        changed = true
        break
      }
    }
  }
  return core
}

export function significantTokens(name: string): string[] {
  return stripLegalSuffix(name)
    .split(" ")
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t) && !/^\d+$/.test(t))
}

function addLegalSuffixes(base: string): string[] {
  const out = new Set<string>([base])
  if (!base) return []
  for (const suffix of [
    "LIMITED",
    "PRIVATE LIMITED",
    "PVT LTD",
    "LTD",
    "LLP",
  ] as const) {
    if (!base.endsWith(suffix)) {
      out.add(`${base} ${suffix}`)
    }
  }
  return [...out]
}

/**
 * Build exact-filter query variants for the MCA API (capped to limit call volume).
 */
export function buildFuzzyNameCandidates(
  name: string,
  maxCandidates = 12
): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()

  const push = (value: string) => {
    const key = value.trim().toUpperCase().replace(/\s+/g, " ")
    if (!key || seen.has(key)) return
    seen.add(key)
    ordered.push(key)
  }

  const raw = name.trim().toUpperCase().replace(/\s+/g, " ")
  push(raw)

  const aggressive = normalizeAggressive(name)
  push(aggressive)

  // "A S INTERNATIONAL" → also try "AS INTERNATIONAL"
  const tokensForInitials = aggressive.split(" ").filter(Boolean)
  let i = 0
  const leadingInitials: string[] = []
  while (i < tokensForInitials.length && tokensForInitials[i].length === 1) {
    leadingInitials.push(tokensForInitials[i])
    i += 1
  }
  const compacted =
    leadingInitials.length >= 2 && i < tokensForInitials.length
      ? [leadingInitials.join(""), ...tokensForInitials.slice(i)].join(" ")
      : null
  if (compacted) push(compacted)

  const core = stripLegalSuffix(aggressive)
  push(core)

  for (const variant of [raw, aggressive, compacted, core].filter(
    (v): v is string => Boolean(v)
  )) {
    for (const withSuffix of addLegalSuffixes(variant)) {
      push(withSuffix)
    }
  }

  const tokens = significantTokens(name)
  if (tokens.length >= 2) {
    const firstTwo = `${tokens[0]} ${tokens[1]}`
    push(firstTwo)
    for (const withSuffix of addLegalSuffixes(firstTwo)) {
      push(withSuffix)
    }
  }

  // Single distinctive token (length ≥ 5) + legal forms — e.g. BERRYBLUES
  if (tokens.length === 1 && tokens[0].length >= 5) {
    for (const withSuffix of addLegalSuffixes(tokens[0])) {
      push(withSuffix)
    }
  } else if (tokens.length >= 2 && tokens[0].length >= 5) {
    push(tokens[0])
    for (const withSuffix of addLegalSuffixes(tokens[0])) {
      push(withSuffix)
    }
  }

  return ordered.slice(0, maxCandidates)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    let prev = i
    row[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      const cur = row[j + 1]
      const cost = a[i] === b[j] ? 0 : 1
      row[j + 1] = Math.min(row[j + 1] + 1, row[j] + 1, prev + cost)
      prev = cur
    }
  }
  return row[b.length]
}

function charSimilarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const dist = levenshtein(a, b)
  const maxLen = Math.max(a.length, b.length)
  return 1 - dist / maxLen
}

function tokenJaccard(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 && bTokens.length === 0) return 1
  if (aTokens.length === 0 || bTokens.length === 0) return 0
  const aSet = new Set(aTokens)
  const bSet = new Set(bTokens)
  let inter = 0
  for (const t of aSet) {
    if (bSet.has(t)) inter += 1
  }
  const union = aSet.size + bSet.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Score how well an MCA company name matches the user/shopping query.
 * 1 = exact core match after normalization.
 */
export function scoreNameSimilarity(query: string, candidateName: string): number {
  const qCore = stripLegalSuffix(query)
  const cCore = stripLegalSuffix(candidateName)
  if (!qCore || !cCore) return 0

  if (qCore === cCore) return 1

  const qTokens = significantTokens(query)
  const cTokens = significantTokens(candidateName)
  const jaccard = tokenJaccard(qTokens, cTokens)
  const chars = charSimilarity(qCore.replace(/\s+/g, ""), cCore.replace(/\s+/g, ""))
  const spaced = charSimilarity(qCore, cCore)

  // Containment boost: query core contained in candidate core (trade name ⊂ legal name)
  let containment = 0
  if (cCore.includes(qCore) || qCore.includes(cCore)) {
    const shorter = Math.min(qCore.length, cCore.length)
    const longer = Math.max(qCore.length, cCore.length)
    containment = shorter / longer
  }

  // Prefer token overlap, then containment, then character similarity
  const score =
    0.4 * jaccard + 0.3 * containment + 0.2 * spaced + 0.1 * chars

  return Math.max(0, Math.min(1, score))
}

export interface FuzzyPickResult {
  recordIndex: number
  score: number
}

/**
 * Pick the best record above the fuzzy threshold. Fail closed if none qualify.
 */
export function pickBestFuzzyMatch<T extends { companyName: string; status: string }>(
  query: string,
  records: T[],
  minScore = FUZZY_MCA_MIN_SCORE
): (FuzzyPickResult & { record: T }) | null {
  if (records.length === 0) return null

  let best: { record: T; score: number; index: number } | null = null

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const score = scoreNameSimilarity(query, record.companyName)
    if (score < minScore) continue

    if (
      !best ||
      score > best.score + 0.02 ||
      (Math.abs(score - best.score) <= 0.02 &&
        record.status.toLowerCase() === "active" &&
        best.record.status.toLowerCase() !== "active")
    ) {
      best = { record, score, index: i }
    }
  }

  if (!best) return null
  return { record: best.record, score: best.score, recordIndex: best.index }
}
