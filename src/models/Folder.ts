import mongoose, { Schema, models, model } from "mongoose";

export interface IFolder {
  name: string;
  parentId: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new Schema<IFolder>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    parentId: { type: Schema.Types.ObjectId, ref: "Folder", default: null, index: true },
  },
  { timestamps: true }
);

// Folder listing is always by parent, sorted by name — index matches that access pattern.
FolderSchema.index({ parentId: 1, name: 1 });

export default (models.Folder as mongoose.Model<IFolder>) || model<IFolder>("Folder", FolderSchema);
