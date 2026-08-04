import FileModel from "@/models/File";

// Fire-and-forget best-effort update — a missed access-log write should never
// fail the request that triggered it.
export function recordFileAccess(fileId: string, username: string): void {
  FileModel.updateOne(
    { _id: fileId },
    { $set: { lastAccessedBy: username, lastAccessedAt: new Date() } }
  ).catch(() => {});
}
