// Node-runtime-only session resolution. middleware.ts (Edge runtime) can
// only verify the cookie's signature — it can't reach MongoDB. So the
// signature check keeps normal page loads fast and blocks anyone without a
// validly-signed cookie at all, while every API route that changes data (or
// needs to know "who is this, right now") calls requireUser() here, which
// re-confirms the session against the database and catches revocation
// (logout-everywhere, or a role change) within one request instead of only
// after the cookie's 7-day expiry.
import { NextRequest } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel, { IUser } from "@/models/User";
import { COOKIE_NAME, parseSessionPayload } from "@/lib/auth";

export interface CurrentUser {
  id: string;
  username: string;
  role: IUser["role"];
}

export async function requireUser(req: NextRequest): Promise<CurrentUser | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const payload = parseSessionPayload(token);
  if (!payload) return null;

  await dbConnect();
  const user = await UserModel.findById(payload.userId).lean();
  if (!user) return null;
  // Accounts created before sessionVersion existed on the schema have no
  // value stored for it at all (not 0 — genuinely absent), which is
  // different from a token whose embedded version is the number 0. Treat
  // both as "version 0" so those older accounts aren't permanently locked
  // out; without this coalesce, undefined !== 0 would reject every request.
  if ((user.sessionVersion ?? 0) !== payload.sessionVersion) return null; // revoked

  return { id: payload.userId, username: user.username, role: user.role };
}
