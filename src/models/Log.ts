import mongoose, { Schema, models, model } from "mongoose";

export interface ILog {
  level: "info" | "warn" | "error";
  action: "upload" | "update" | "delete" | "export" | "search" | "system";
  message: string;
  meta?: Record<string, unknown>;
  fileId?: Schema.Types.ObjectId;
  createdAt: Date;
}

const LogSchema = new Schema<ILog>({
  level: { type: String, enum: ["info", "warn", "error"], required: true },
  action: {
    type: String,
    enum: ["upload", "update", "delete", "export", "search", "system"],
    required: true,
  },
  message: { type: String, required: true, maxlength: 1000 },
  meta: { type: Schema.Types.Mixed },
  fileId: { type: Schema.Types.ObjectId, ref: "File" },
  createdAt: { type: Date, default: Date.now },
});

LogSchema.index({ createdAt: -1 });
LogSchema.index({ level: 1, action: 1 });

export default (models.Log as mongoose.Model<ILog>) || model<ILog>("Log", LogSchema);
