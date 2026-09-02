import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  clearIndiamartCache,
  mapIndiamartItem,
  parseIndiamartPrice,
  searchIndiamart,
} from "@/lib/catalog/providers/indiamart"

vi.mock("@/lib/config/env", () => ({
  getApifyToken: vi.fn(() => "test-token"),
  getIndiamartActorId: vi.fn(() => "makework36~indiamart-suppliers-scraper"),
}))

describe("parseIndiamartPrice", () => {
  it("parses numeric and string INR prices", () => {
    expect(parseIndiamartPrice(140)).toBe(140)
    expect(parseIndiamartPrice("₹ 140 / Meter")).toBe(140)
    expect(parseIndiamartPrice("1,250")).toBe(1250)
    expect(parseIndiamartPrice("n/a")).toBeNull()
    expect(parseIndiamartPrice(null)).toBeNull()
  })
})

describe("mapIndiamartItem", () => {
  it("maps supplier identity fields for TrustGate lookup", () => {
    const candidate = mapIndiamartItem({
      companyName: "Avika Textiles",
      city: "Surat",
      url: "https://www.indiamart.com/avika/",
      gstNumber: "27AAACR1234E1Z5",
      product: {
        price: "₹ 140 / Meter",
        priceNumeric: 140,
      },
    })

    expect(candidate).toEqual({
      merchantName: "Avika Textiles",
      amount: 140,
      currency: "INR",
      source: "indiamart",
      sourceUrl: "https://www.indiamart.com/avika/",
      city: "Surat",
      raw: { gstNumber: "27AAACR1234E1Z5" },
    })
  })

  it("returns null without a company name", () => {
    expect(mapIndiamartItem({ product: { priceNumeric: 99 } })).toBeNull()
  })
})

describe("searchIndiamart", () => {
  beforeEach(() => {
    clearIndiamartCache()
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("maps a mocked Apify response and caches by query", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          companyName: "Avika Textiles",
          city: "Surat",
          url: "https://www.indiamart.com/avika/",
          product: { priceNumeric: 140 },
        },
        {
          companyName: "avika textiles",
          city: "Surat",
          product: { priceNumeric: 130 },
        },
      ],
    } as Response)

    const first = await searchIndiamart("cotton fabric")
    const second = await searchIndiamart("Cotton Fabric")

    expect(first).toHaveLength(1)
    expect(first[0]?.merchantName).toBe("Avika Textiles")
    expect(first[0]?.amount).toBe(140)
    expect(second).toEqual(first)
    expect(fetch).toHaveBeenCalledTimes(1)

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).toContain("makework36~indiamart-suppliers-scraper")
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      searchKeywords: ["cotton fabric"],
      maxSuppliersPerCategory: 10,
    })
  })

  it("returns [] on API failure without throwing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    await expect(searchIndiamart("star wars t-shirt")).resolves.toEqual([])
  })

  it("returns [] on timeout / network error without throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("aborted"))

    await expect(searchIndiamart("star wars t-shirt")).resolves.toEqual([])
  })
})
