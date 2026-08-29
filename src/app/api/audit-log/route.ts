import { NextResponse } from "next/server";
import { getAuditLog } from "@/lib/audit/logger";

export async function GET() {
  return NextResponse.json({ entries: getAuditLog() });
}
