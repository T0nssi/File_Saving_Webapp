import mongoose, { Schema, models, model } from "mongoose";

export interface IRevision {
  fileId: mongoose.Types.ObjectId;
  versionNumber: number;
  gridFsId: mongoose.Types.ObjectId;
  changedBy: string;
  changesSummary: string;
  size: number;
  createdAt: Date;
}

const RevisionSchema = new Schema<IRevision>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: "File", required: true, index: true },
    versionNumber: { type: Number, required: true },
    gridFsId: { type: Schema.Types.ObjectId, required: true },
    changedBy: { type: String, required: true, trim: true },
    changesSummary: { type: String, default: "" },
    size: { type: Number, required: true },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false },
  }
);

RevisionSchema.index({ fileId: 1, versionNumber: 1 });

export default (models.Revision as mongoose.Model<IRevision>) || model<IRevision>("Revision", RevisionSchema);
