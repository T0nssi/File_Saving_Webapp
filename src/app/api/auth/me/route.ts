import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

// Unlike middleware's cheap signature-only check, this confirms the session
// against the database — so a revoked session (see /api/auth/logout-all)
// stops showing as logged in here immediately, not just after expiry.
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ username: null, role: null }, { status: 401 });
  return NextResponse.json({ username: user.username, role: user.role });
}
