import type { FileDoc, Paginated } from "@/types";

// Module-scope, not component state: survives navigating away from Search
// and back within the same page load (e.g. opening Edit on a file, then
// pressing Back), so that specific filter combination renders instantly
// instead of showing a loading spinner again. Resets on a full page reload,
// which is fine — this is a speed nicety, not a source of truth.
const cache = new Map<string, Paginated<FileDoc>>();
const MAX_ENTRIES = 30; // small bound so this can never grow unbounded in a long session

export function getCachedSearch(key: string): Paginated<FileDoc> | undefined {
  return cache.get(key);
}

export function setCachedSearch(key: string, value: Paginated<FileDoc>): void {
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}
