import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel from "@/models/User";
import Log from "@/models/Log";
import { verifyPassword, sanitizeUsername } from "@/lib/password";
import { createSessionToken, isRequestSecure, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";
import { escapeRegex } from "@/lib/search";
import { logEvent } from "@/lib/logger";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = await req.json();
    const username = sanitizeUsername(String(body.username ?? ""));
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      return NextResponse.json({ error: "กรอกชื่อผู้ใช้และรหัสผ่าน" }, { status: 400 });
    }

    // Reuses the existing log collection instead of adding a dedicated
    // rate-limit store: every failed attempt is already logged below, so a
    // recent-failure count for this username is enough to slow down
    // brute-forcing without any new schema or service.
    const recentFailures = await Log.countDocuments({
      action: "system",
      level: "warn",
      message: new RegExp(`^Failed login attempt for "${escapeRegex(username)}"$`),
      createdAt: { $gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
    });
    if (recentFailures >= RATE_LIMIT_MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429 }
      );
    }

    const user = await UserModel.findOne({ username });
    if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      await logEvent({
        level: "warn",
        action: "system",
        message: `Failed login attempt for "${username}"`,
      });
      return NextResponse.json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
    }

    // ?? 0 guards against accounts created before sessionVersion existed on
    // the schema — their stored value is genuinely absent (not 0), and
    // embedding "undefined" into the token would make it fail to parse on
    // every subsequent request (see lib/session.ts).
    const token = await createSessionToken(user._id.toString(), user.username, user.sessionVersion ?? 0);
    const res = NextResponse.json({ success: true, username: user.username, role: user.role });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isRequestSecure(req),
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });

    await logEvent({ level: "info", action: "system", message: `"${user.username}" logged in` });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown login error";
    await logEvent({ level: "error", action: "system", message });
    return NextResponse.json({ error: "เข้าสู่ระบบไม่สำเร็จ" }, { status: 500 });
  }
}
