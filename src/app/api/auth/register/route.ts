import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel from "@/models/User";
import { hashPassword, sanitizeUsername, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH } from "@/lib/password";
import { createSessionToken, isRequestSecure, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import { logEvent } from "@/lib/logger";

// Lets /login and /register decide whether to show the "sign in" flow or
// the "create the first account" flow, without guessing.
export async function GET() {
  await dbConnect();
  const hasUsers = (await UserModel.countDocuments()) > 0;
  return NextResponse.json({ hasUsers });
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = await req.json();
    const username = sanitizeUsername(String(body.username ?? ""));
    const password = typeof body.password === "string" ? body.password : "";

    if (username.length < MIN_USERNAME_LENGTH) {
      return NextResponse.json(
        { error: `ชื่อผู้ใช้ต้องมีอย่างน้อย ${MIN_USERNAME_LENGTH} ตัวอักษร (a-z, 0-9, _ . -)` },
        { status: 400 }
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` },
        { status: 400 }
      );
    }

    const existingCount = await UserModel.countDocuments();
    const isBootstrap = existingCount === 0;

    // Once at least one account exists, only an admin may create further
    // accounts — registration is not left open to anyone signed in, let
    // alone the public internet, indefinitely.
    if (!isBootstrap) {
      const requester = await requireUser(req);
      if (!requester) {
        return NextResponse.json(
          { error: "ต้องเข้าสู่ระบบก่อนจึงจะเพิ่มผู้ใช้ใหม่ได้" },
          { status: 401 }
        );
      }
      if (requester.role !== "admin") {
        return NextResponse.json(
          { error: "ต้องเป็นแอดมินเท่านั้นถึงจะเพิ่มผู้ใช้ใหม่ได้" },
          { status: 403 }
        );
      }
    }

    const taken = await UserModel.findOne({ username });
    if (taken) {
      return NextResponse.json({ error: "มีชื่อผู้ใช้นี้อยู่แล้ว" }, { status: 409 });
    }

    const { hash, salt } = hashPassword(password);
    // The very first account in the vault is the admin; everyone an admin
    // adds afterwards starts as a regular member.
    const role = isBootstrap ? "admin" : "member";
    const user = await UserModel.create({ username, passwordHash: hash, passwordSalt: salt, role });

    await logEvent({
      level: "info",
      action: "system",
      message: isBootstrap ? `Bootstrapped first user "${username}" (admin)` : `Created user "${username}"`,
    });

    const res = NextResponse.json({ success: true, username: user.username, bootstrap: isBootstrap });

    // Only auto-login for the very first account (nobody was signed in to
    // do the creating). Adding a teammate from an existing session must not
    // silently swap the admin's own session out for the new account.
    if (isBootstrap) {
      // Same reasoning as the login route: never let an undefined
      // sessionVersion (legacy accounts predating this field) get baked
      // into the token as the literal string "undefined".
      const token = await createSessionToken(user._id.toString(), user.username, user.sessionVersion ?? 0);
      res.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: isRequestSecure(req),
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });
    }

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown register error";
    await logEvent({ level: "error", action: "system", message });
    return NextResponse.json({ error: "สร้างผู้ใช้ไม่สำเร็จ" }, { status: 500 });
  }
}
