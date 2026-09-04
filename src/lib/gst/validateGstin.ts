/** GSTIN state/UT codes (TIN prefix). */
export const GSTIN_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
}

const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/

const CHECKSUM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function normalizeGstin(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "")
}

/** GSTN mod-36 check digit over the first 14 characters. */
export function gstinCheckDigit(body14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const idx = CHECKSUM_CHARS.indexOf(body14[i]!)
    if (idx < 0) return ""
    const factor = i % 2 === 0 ? 1 : 2
    const product = idx * factor
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHECKSUM_CHARS[(36 - (sum % 36)) % 36]!
}

export function validateGstinChecksum(gstin: string): boolean {
  const normalized = normalizeGstin(gstin)
  if (normalized.length !== 15) return false
  return gstinCheckDigit(normalized.slice(0, 14)) === normalized[14]
}

export interface GstinValidation {
  ok: boolean
  gstin: string
  reason?: string
  stateCode?: string
  stateName?: string
  pan?: string
}

/**
 * Structural GSTIN validation: length, charset, state code, embedded PAN shape, checksum.
 * No network.
 */
export function validateGstin(input: string): GstinValidation {
  const gstin = normalizeGstin(input)
  if (!gstin) {
    return { ok: false, gstin, reason: "empty" }
  }
  if (gstin.length !== 15) {
    return { ok: false, gstin, reason: "length" }
  }
  if (!GSTIN_PATTERN.test(gstin)) {
    return { ok: false, gstin, reason: "format" }
  }

  const stateCode = gstin.slice(0, 2)
  const stateName = GSTIN_STATE_CODES[stateCode]
  if (!stateName) {
    return { ok: false, gstin, reason: "state_code", stateCode }
  }

  const pan = gstin.slice(2, 12)
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return { ok: false, gstin, reason: "pan", stateCode, stateName, pan }
  }

  if (!validateGstinChecksum(gstin)) {
    return { ok: false, gstin, reason: "checksum", stateCode, stateName, pan }
  }

  return { ok: true, gstin, stateCode, stateName, pan }
}
