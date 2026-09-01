import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchCompany, clearMcaCache } from "@/lib/registry/mcaLookup";

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

    const result = await searchCompany("Infosys Limited");
    expect(result).toBeNull();
  });

  it("returns null on network failure without throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const result = await searchCompany("Infosys Limited");
    expect(result).toBeNull();
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
});
