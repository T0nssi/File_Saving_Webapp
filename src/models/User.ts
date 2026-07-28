import mongoose, { Schema, models, model } from "mongoose";

export interface IUser {
  username: string; // stored lowercase, unique
  passwordHash: string; // hex-encoded scrypt hash
  passwordSalt: string; // hex-encoded random salt
  role: "admin" | "member";
  // Bumped whenever this user's sessions should all be invalidated at once
  // (see lib/session.ts) — a signed cookie's embedded version has to match
  // the current value here or it's treated as logged out.
  sessionVersion: number;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 40 },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    sessionVersion: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

export default (models.User as mongoose.Model<IUser>) || model<IUser>("User", UserSchema);
