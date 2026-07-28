import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel from "@/models/User";
import { requireUser } from "@/lib/session";
import { COOKIE_NAME } from "@/lib/auth";
import { logEvent } from "@/lib/logger";

// Bumping sessionVersion means every cookie issued before this moment stops
// matching (see lib/session.ts) — a real "sign out everywhere", including
// devices/browsers other than the one making this request, without needing
// a server-side session store keyed by token.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });

  await dbConnect();
  await UserModel.updateOne({ _id: user.id }, { $inc: { sessionVersion: 1 } });
  await logEvent({ level: "info", action: "system", message: `"${user.username}" signed out of all devices` });

  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
