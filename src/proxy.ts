import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { denyUnlessControlAccess } from "@/lib/config/controlAuth"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === "/api/auth") {
    return NextResponse.next()
  }

  const denied = denyUnlessControlAccess(request)
  if (denied) return denied
  return NextResponse.next()
}

export const config = {
  matcher: ["/api/:path*"],
}
