import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel from "@/models/User";
import { requireUser } from "@/lib/session";

// Any authenticated user can list other usernames — needed to pick a
// recipient when sharing a file. No sensitive fields are exposed (no
// password hash/salt, no role), just the identifiers people share by.
export async function GET(req: NextRequest) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await dbConnect();
  const users = await UserModel.find({ _id: { $ne: requester.id } })
    .select("_id username")
    .sort({ username: 1 })
    .lean();

  return NextResponse.json({ users });
}
