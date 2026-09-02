import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  clearIndiamartCache,
  inferIndiamartCategorySlug,
  mapIndiamartItem,
  parseIndiamartPrice,
  searchIndiamart,
} from "@/lib/catalog/providers/indiamart"
import { getIndiamartActorId } from "@/lib/config/env"

vi.mock("@/lib/config/env", () => ({
  getApifyToken: vi.fn(() => "test-token"),
  getIndiamartActorId: vi.fn(() => "sourabhbgp~indiamart-scraper"),
}))

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn(),
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

describe("inferIndiamartCategorySlug", () => {
  it("maps t-shirt queries to t-shirts category", () => {
    expect(inferIndiamartCategorySlug("white star wars t-shirt")).toBe(
      "t-shirts"
    )
    expect(inferIndiamartCategorySlug("mens tee")).toBe("t-shirts")
  })
})

describe("mapIndiamartItem", () => {
  it("maps makework36-style supplier fields", () => {
    const candidate = mapIndiamartItem({
      companyName: "Avika Textiles",
      city: "Surat",
      companyUrl: "https://www.indiamart.com/avika/",
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

  it("maps sourabhbgp product-search fields", () => {
    const candidate = mapIndiamartItem({
      companyName: "S Creation",
      supplierCity: "Tiruppur",
      supplierUrl: "https://www.indiamart.com/screation/",
      price: "₹ 450/Piece",
      productName: "White Star Wars T Shirt",
    })

    expect(candidate).toEqual({
      merchantName: "S Creation",
      amount: 450,
      currency: "INR",
      source: "indiamart",
      sourceUrl: "https://www.indiamart.com/screation/",
      city: "Tiruppur",
      raw: { productName: "White Star Wars T Shirt" },
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
    vi.mocked(getIndiamartActorId).mockReturnValue(
      "sourabhbgp~indiamart-scraper"
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("maps a mocked Apify response and caches by query", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          companyName: "S Creation",
          supplierCity: "Tiruppur",
          supplierUrl: "https://www.indiamart.com/screation/",
          price: "₹ 450/Piece",
        },
        {
          companyName: "s creation",
          supplierCity: "Tiruppur",
          price: "₹ 400/Piece",
        },
      ],
    } as Response)

    const first = await searchIndiamart("white star wars t-shirt")
    const second = await searchIndiamart("White Star Wars T-Shirt")

    expect(first).toHaveLength(1)
    expect(first[0]?.merchantName).toBe("S Creation")
    expect(first[0]?.amount).toBe(450)
    expect(second).toEqual(first)
    expect(fetch).toHaveBeenCalledTimes(1)

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).toContain("sourabhbgp~indiamart-scraper")
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      mode: "search",
      searchQueries: ["white star wars t-shirt"],
      maxResults: 10,
    })
  })

  it("retries makework36 via category slug when keywords miss", async () => {
    vi.mocked(getIndiamartActorId).mockReturnValue(
      "makework36~indiamart-suppliers-scraper"
    )
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            companyName: "Gopesh Uniforms",
            city: "Mumbai",
            companyUrl: "https://www.indiamart.com/gopesh/",
            product: { priceNumeric: 200 },
          },
        ],
      } as Response)

    const result = await searchIndiamart("white star wars t-shirt")
    expect(result).toHaveLength(1)
    expect(result[0]?.merchantName).toBe("Gopesh Uniforms")
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body))).toEqual({
      categorySlugs: ["t-shirts"],
      searchKeywords: [],
      maxSuppliersPerCategory: 10,
    })
  })

  it("returns [] on API failure without throwing and does not cache failures", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    } as Response)

    await expect(searchIndiamart("star wars t-shirt")).resolves.toEqual([])
    await expect(searchIndiamart("star wars t-shirt")).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("returns [] on timeout / network error without throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("aborted"))

    await expect(searchIndiamart("star wars t-shirt")).resolves.toEqual([])
    await expect(searchIndiamart("star wars t-shirt")).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
