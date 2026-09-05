import { NextResponse } from "next/server";
import {
  getUserPolicy,
  resetUserPolicy,
  setUserPolicy,
} from "@/lib/config/runtimePolicy";
import { userPolicySchema } from "@/lib/config/policySchema";
import { denyUnlessControlAccess } from "@/lib/config/controlAuth";

export async function GET(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

  return NextResponse.json({ userPolicy: getUserPolicy() });
}

export async function PUT(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

  const body = await request.json();
  const parsed = userPolicySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid policy", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const userPolicy = setUserPolicy(parsed.data);
  return NextResponse.json({ userPolicy });
}

export async function DELETE(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

  const userPolicy = resetUserPolicy();
  return NextResponse.json({ userPolicy });
}
