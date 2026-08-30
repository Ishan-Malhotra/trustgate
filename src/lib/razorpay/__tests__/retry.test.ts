import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRazorpayRetry } from "@/lib/razorpay/retry";

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn(),
}));

describe("withRazorpayRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success without retry", async () => {
    const result = await withRazorpayRetry("createOrder", async () => 42);
    expect(result).toEqual({
      success: true,
      data: 42,
      retried: false,
      flagged: false,
    });
  });

  it("retries once then succeeds", async () => {
    let calls = 0;
    const result = await withRazorpayRetry("createOrder", async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return "ok";
    });
    expect(calls).toBe(2);
    expect(result.success).toBe(true);
    expect(result.retried).toBe(true);
    expect(result.flagged).toBe(false);
    expect(result.data).toBe("ok");
  });

  it("flags unresolved after retry fails", async () => {
    const result = await withRazorpayRetry("createOrder", async () => {
      throw new Error("hard fail");
    });
    expect(result.success).toBe(false);
    expect(result.retried).toBe(true);
    expect(result.flagged).toBe(true);
    expect(result.error).toBe("hard fail");
  });
});
