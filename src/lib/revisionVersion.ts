import FileModel from "@/models/File";
import RevisionModel from "@/models/Revision";

// Atomically claims the next revision version number for a file.
//
// Backfills File.currentVersion from the highest existing Revision.versionNumber
// first: files that already had revisions before currentVersion was introduced
// (or from any prior non-atomic versioning) would otherwise start counting from 0
// again and collide with a versionNumber that already exists, tripping the unique
// (fileId, versionNumber) index and failing the save/restore.
export async function claimNextVersion(fileId: string): Promise<number> {
  const maxRevision = await RevisionModel.findOne({ fileId })
    .sort({ versionNumber: -1 })
    .select("versionNumber")
    .lean<{ versionNumber: number }>();

  if (maxRevision && maxRevision.versionNumber > 0) {
    await FileModel.findByIdAndUpdate(fileId, { $max: { currentVersion: maxRevision.versionNumber } });
  }

  const updated = await FileModel.findByIdAndUpdate(
    fileId,
    { $inc: { currentVersion: 1 } },
    { new: true }
  );
  if (!updated) {
    throw new Error("File not found during version update");
  }
  return updated.currentVersion;
}
