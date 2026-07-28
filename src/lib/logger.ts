import { dbConnect } from "./mongodb";
import Log from "@/models/Log";
import type { LogAction, LogLevel } from "@/types";

interface LogInput {
  level: LogLevel;
  action: LogAction;
  message: string;
  meta?: Record<string, unknown>;
  fileId?: string;
}

/**
 * Writes a history/error entry to MongoDB. Never throws — logging failures
 * must not break the request that triggered them, so errors are swallowed
 * after being reported to the console.
 */
export async function logEvent(input: LogInput): Promise<void> {
  const { level, action, message, meta, fileId } = input;

  if (level === "error") console.error(`[${action}] ${message}`, meta ?? "");
  else if (level === "warn") console.warn(`[${action}] ${message}`, meta ?? "");
  else console.log(`[${action}] ${message}`);

  try {
    await dbConnect();
    await Log.create({ level, action, message, meta, fileId });
  } catch (err) {
    console.error("Failed to persist log entry:", err);
  }
}
