import { NextResponse } from "next/server";
import { getAllSellers } from "@/lib/sellers";
import { scoreSeller } from "@/lib/trust/scoreSeller";
import { getSpendLimit } from "@/lib/trust/getSpendLimit";
import { getUserPolicy } from "@/lib/config/runtimePolicy";
import { isLlmConfigured, getAnthropicWorkspaceId } from "@/lib/config/env";
import { isRazorpayConfigured } from "@/lib/razorpay/client";
import { isPaymentsKilled } from "@/lib/config/killSwitch";
import { denyUnlessControlAccess } from "@/lib/config/controlAuth";

export async function GET(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const includeScores = searchParams.get("dev") === "1";

  const sellers = getAllSellers().map(({ _comment, ...seller }) => {
    if (!includeScores) {
      return {
        id: seller.id,
        name: seller.name,
        category: seller.category,
        known_for: seller.known_for,
        listings: seller.listings,
      };
    }

    const { score, tier, breakdown } = scoreSeller(seller);
    const spendLimit = getSpendLimit(tier, score);
    return { ...seller, score, tier, spendLimit, breakdown };
  });

  return NextResponse.json({
    sellers,
    userPolicy: getUserPolicy(),
    llmConfigured: isLlmConfigured(),
    anthropicWorkspaceConfigured: Boolean(getAnthropicWorkspaceId()),
    razorpayConfigured: isRazorpayConfigured(),
    paymentsKilled: await isPaymentsKilled(),
  });
}
