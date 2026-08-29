import { NextResponse } from "next/server";
import { USER_POLICY } from "@/lib/config/userPolicy";

export async function GET() {
  return NextResponse.json({ userPolicy: USER_POLICY });
}
