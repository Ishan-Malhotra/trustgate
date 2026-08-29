import { NextResponse } from "next/server";
import { getAllSellers } from "@/lib/sellers";
import { scoreSeller } from "@/lib/trust/scoreSeller";
import { getSpendLimit } from "@/lib/trust/getSpendLimit";
import { USER_POLICY } from "@/lib/config/userPolicy";

export async function GET() {
  const sellers = getAllSellers().map(({ _comment, ...seller }) => {
    const { score, tier, breakdown } = scoreSeller(seller);
    const spendLimit = getSpendLimit(tier, score);
    return { ...seller, score, tier, spendLimit, breakdown };
  });

  return NextResponse.json({ sellers, userPolicy: USER_POLICY });
}
