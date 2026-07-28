import type { FilterQuery } from "mongoose";
import type { IFile } from "@/models/File";

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "Multi search": splits the query into individual keywords and requires
 * every keyword to appear *somewhere* — filename, description, or a tag —
 * rather than needing one exact phrase. Substring (not whole-word) matching
 * means partial/similar words match too ("invoic" still finds "invoice",
 * and this works for Thai text where MongoDB's $text stemmer doesn't help).
 */
export function buildTextFilter(q: string): FilterQuery<IFile>[] {
  const keywords = q
    .split(/\s+/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 10); // a reasonable ceiling on how many terms one search needs

  return keywords.map((keyword) => {
    const pattern = escapeRegex(keyword);
    const regex = new RegExp(pattern, "i");
    return {
      $or: [{ filename: regex }, { description: regex }, { tags: regex }],
    };
  });
}
