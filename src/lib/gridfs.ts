import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import { dbConnect } from "./mongodb";

const BUCKET_NAME = "uploads";

let bucket: GridFSBucket | null = null;

export async function getBucket(): Promise<GridFSBucket> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection not ready");

  if (!bucket) {
    bucket = new GridFSBucket(db, { bucketName: BUCKET_NAME });
  }
  return bucket;
}
