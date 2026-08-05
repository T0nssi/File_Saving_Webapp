import type { GridFSBucket } from "mongodb";
import FileModel from "@/models/File";
import RevisionModel from "@/models/Revision";

// Fully removes a file: its current GridFS blob, every revision's GridFS
// blob (each revision owns its own permanent blob — see excel/route.ts),
// the Revision documents, and the File document itself. Shared by the
// single-file DELETE route and the folder recursive-delete path so both
// clean up storage the same way instead of leaking GridFS chunks.
export async function deleteFileCompletely(fileId: string, gridFsId: unknown, bucket: GridFSBucket): Promise<void> {
  try {
    await bucket.delete(gridFsId as Parameters<GridFSBucket["delete"]>[0]);
  } catch {
    // File bytes may already be gone; still remove the metadata record.
  }

  const revisions = await RevisionModel.find({ fileId }).select("gridFsId").lean();
  for (const rev of revisions) {
    try {
      await bucket.delete(rev.gridFsId);
    } catch {
      // Blob may already be gone; continue cleaning up the rest.
    }
  }
  await RevisionModel.deleteMany({ fileId });
  await FileModel.deleteOne({ _id: fileId });
}
