import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = typeof body.message === "string" ? body.message.slice(0, 500) : "Unknown client error";
    await logEvent({
      level: "error",
      action: "system",
      message: `Client error: ${message}`,
      meta: { digest: body.digest },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
