import { NextResponse } from "next/server";
import { getAllSellers } from "@/lib/sellers";

export async function GET() {
  const sellers = getAllSellers().map(({ _comment, ...seller }) => seller);
  return NextResponse.json({ sellers });
}
