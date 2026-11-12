export const DAY_MS: number;
export function normalizeRelPath(p: string): string;
export function classifyUploads(input: {
  files: { path: string; mtimeMs: number }[];
  referencedPaths: Iterable<string>;
  now: number;
  minAgeMs?: number;
}): { referenced: string[]; orphans: string[]; tooYoung: string[] };
