// Pure matching logic for find-orphan-uploads.js — no filesystem, no
// database, so it can be unit-tested with plain data.
const path = require('node:path');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Brings a path to the form used as a key for comparison: POSIX separators,
 * no leading "./", no "." segments. The database stores paths relative to
 * the uploads root with forward slashes (e.g.
 * "12/cover-front-1-3f9a0c41b2de-full.webp").
 */
function normalizeRelPath(p) {
  return path.posix
    .normalize(String(p).replace(/\\/g, '/'))
    .replace(/^\.\//, '');
}

/**
 * Sorts the files found on disk into referenced / orphaned / too young.
 *
 * @param {object} input
 * @param {{ path: string, mtimeMs: number }[]} input.files  Files under the
 *   uploads root; `path` is relative to it.
 * @param {Iterable<string>} input.referencedPaths  Every fullPath and
 *   thumbPath of every VinylImage row — soft-deleted rows included, their
 *   files are still needed until the purge removes them.
 * @param {number} input.now  Current time in ms.
 * @param {number} [input.minAgeMs]  Files younger than this are never
 *   reported as orphans (default one day).
 * @returns {{ referenced: string[], orphans: string[], tooYoung: string[] }}
 */
function classifyUploads({ files, referencedPaths, now, minAgeMs = DAY_MS }) {
  const referencedSet = new Set();
  for (const p of referencedPaths) referencedSet.add(normalizeRelPath(p));

  const referenced = [];
  const orphans = [];
  const tooYoung = [];
  for (const file of files) {
    const rel = normalizeRelPath(file.path);
    if (referencedSet.has(rel)) referenced.push(rel);
    else if (now - file.mtimeMs < minAgeMs) tooYoung.push(rel);
    else orphans.push(rel);
  }
  return { referenced, orphans, tooYoung };
}

module.exports = { classifyUploads, normalizeRelPath, DAY_MS };
