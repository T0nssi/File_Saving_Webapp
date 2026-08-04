import mongoose, { Schema, models, model } from "mongoose";

export interface IFile {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  gridFsId: mongoose.Types.ObjectId;
  tags: string[];
  description: string;
  folderId: mongoose.Types.ObjectId | null;
  uploadedBy: string;
  currentVersion: number;
  sourceFileId: mongoose.Types.ObjectId | null;
  uploadedAt: Date;
  updatedAt: Date;
}

const FileSchema = new Schema<IFile>(
  {
    filename: { type: String, required: true, trim: true, maxlength: 255 },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, trim: true },
    size: { type: Number, required: true, min: 0 },
    gridFsId: { type: Schema.Types.ObjectId, required: true },
    tags: { type: [String], default: [], index: true },
    description: { type: String, default: "", maxlength: 2000 },
    // null = not filed into any folder yet ("ยังไม่จัดหมวด" in the UI).
    folderId: { type: Schema.Types.ObjectId, ref: "Folder", default: null, index: true },
    uploadedBy: { type: String, default: "", trim: true, maxlength: 40 },
    // Monotonically incremented via atomic $inc on each Excel save; source of truth for revision versionNumber.
    currentVersion: { type: Number, default: 0 },
    // Set only on files created via Save As / clone — the file this one was cloned from,
    // so the UI can show "cloned from <master>" and link back to it.
    sourceFileId: { type: Schema.Types.ObjectId, ref: "File", default: null, index: true },
  },
  {
    timestamps: { createdAt: "uploadedAt", updatedAt: "updatedAt" },
  }
);

// Text index powers the free-text search box (filename + description + tags).
FileSchema.index({ filename: "text", description: "text", tags: "text" });

export default (models.File as mongoose.Model<IFile>) || model<IFile>("File", FileSchema);
