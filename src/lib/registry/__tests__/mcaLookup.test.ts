import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchCompany,
  searchCompanyDetailed,
  clearMcaCache,
} from "@/lib/registry/mcaLookup";

const INFOSYS_RESPONSE = {
  records: [
    {
      CIN: "L85110KA1981PLC013115",
      CompanyName: "INFOSYS LIMITED",
      CompanyRegistrationdate_date: "1981-07-02",
      CompanyStatus: "Active",
      AuthorizedCapital: "24000000000.00",
      PaidupCapital: "20278293815.00",
      CompanyStateCode: "karnataka",
      nic_code: "85110",
      CompanyROCcode: "ROC Bangalore",
    },
  ],
};

describe("searchCompany", () => {
  beforeEach(() => {
    clearMcaCache();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null on API error without throwing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    const result = await searchCompanyDetailed("Infosys Limited");
    expect(result.record).toBeNull();
    expect(result.failureReason).toBe("api-error");
  });

  it("returns null on network failure without throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const result = await searchCompanyDetailed("Infosys Limited");
    expect(result.record).toBeNull();
    expect(result.failureReason).toBe("api-error");
  });

  it("maps a successful MCA response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => INFOSYS_RESPONSE,
    } as Response);

    const result = await searchCompany("Infosys Limited");
    expect(result?.companyName).toBe("INFOSYS LIMITED");
    expect(result?.cin).toBe("L85110KA1981PLC013115");
    expect(result?.status).toBe("Active");
  });

  it("caches results for the same name", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => INFOSYS_RESPONSE,
    } as Response);

    await searchCompany("Infosys Limited");
    await searchCompany("Infosys Limited");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("tries name suffix when initial exact match fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INFOSYS_RESPONSE,
      } as Response);

    const result = await searchCompany("INFOSYS");
    expect(result?.companyName).toBe("INFOSYS LIMITED");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves verified cache after transient API error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INFOSYS_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

    const first = await searchCompanyDetailed("Infosys Limited");
    expect(first.record?.companyName).toBe("INFOSYS LIMITED");
    expect(first.source).toBe("api");

    const second = await searchCompanyDetailed("Infosys Limited");
    expect(second.record?.companyName).toBe("INFOSYS LIMITED");
    expect(second.source).toBe("verified-cache");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries via cached CIN when name search misses after prior CIN lookup", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => INFOSYS_RESPONSE,
    } as Response);

    const byCin = await searchCompanyDetailed("L85110KA1981PLC013115");
    expect(byCin.record?.companyName).toBe("INFOSYS LIMITED");

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INFOSYS_RESPONSE,
      } as Response);

    const result = await searchCompanyDetailed("Infosys Limited");
    expect(result.record?.cin).toBe("L85110KA1981PLC013115");
    expect(result.source).toBe("verified-cache");
  });

  it("accepts punctuation-normalized fuzzy name when exact miss", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("A.S.INTERNATIONAL") && !url.includes("A+S")) {
        return {
          ok: true,
          json: async () => ({ records: [] }),
        } as Response
      }
      if (
        url.includes("A+S+INTERNATIONAL") ||
        url.includes("AS+INTERNATIONAL") ||
        decodeURIComponent(url).includes("A S INTERNATIONAL") ||
        decodeURIComponent(url).includes("AS INTERNATIONAL")
      ) {
        return {
          ok: true,
          json: async () => ({
            records: [
              {
                CIN: "U12345MH2020PTC123456",
                CompanyName: "A S INTERNATIONAL PRIVATE LIMITED",
                CompanyRegistrationdate_date: "2020-01-01",
                CompanyStatus: "Active",
                AuthorizedCapital: "100000.00",
                PaidupCapital: "100000.00",
                CompanyStateCode: "maharashtra",
                nic_code: "1234",
                CompanyROCcode: "ROC Mumbai",
              },
            ],
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ records: [] }),
      } as Response
    })

    const result = await searchCompanyDetailed("A.S.International")
    expect(result.record?.companyName).toBe(
      "A S INTERNATIONAL PRIVATE LIMITED"
    )
    expect(result.matchScore).toBeGreaterThanOrEqual(0.72)
    expect(["exact", "fuzzy"]).toContain(result.matchKind)
  })

  it("rejects API hit when company name is unrelated (fail closed)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            CIN: "L85110KA1981PLC013115",
            CompanyName: "INFOSYS LIMITED",
            CompanyRegistrationdate_date: "1981-07-02",
            CompanyStatus: "Active",
            AuthorizedCapital: "1",
            PaidupCapital: "1",
            CompanyStateCode: "karnataka",
            nic_code: "1",
            CompanyROCcode: "ROC Bangalore",
          },
        ],
      }),
    } as Response)

    const result = await searchCompanyDetailed("Totally Unrelated Traders")
    // First candidate may get Infosys back from overly broad mock — scoring must reject
    expect(result.record).toBeNull()
    expect(result.failureReason).toBe("no-match")
  })
})