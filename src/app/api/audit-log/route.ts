import { NextResponse } from "next/server";
import { clearAuditLog, getAuditLog } from "@/lib/audit/logger";
import { denyUnlessControlAccess } from "@/lib/config/controlAuth";

export async function GET(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

  return NextResponse.json({ entries: getAuditLog() });
}

export async function DELETE(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

  clearAuditLog();
  return NextResponse.json({ entries: [] });
}
