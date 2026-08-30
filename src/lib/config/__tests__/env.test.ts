import { describe, it, expect } from "vitest";
import { parseEnvFile } from "@/lib/config/env";

describe("parseEnvFile", () => {
  it("reads unquoted values and ignores comments", () => {
    const parsed = parseEnvFile(
      "# comment\nANTHROPIC_API_KEY=sk-ant-test\nRAZORPAY_KEY_ID=\n"
    );
    expect(parsed.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(parsed.RAZORPAY_KEY_ID).toBe("");
  });

  it("strips quotes", () => {
    const parsed = parseEnvFile(`ANTHROPIC_API_KEY="sk-ant-quoted"\n`);
    expect(parsed.ANTHROPIC_API_KEY).toBe("sk-ant-quoted");
  });
});
