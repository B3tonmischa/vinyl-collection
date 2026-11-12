import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { classifyUploads, DAY_MS } from '../scripts/orphan-uploads';

// Only temp directories are used here; nothing touches a real data/ folder.
describe('classifyUploads', () => {
  const now = Date.UTC(2026, 10, 12);
  const old = now - 3 * DAY_MS;
  const file = (p: string, mtimeMs = old) => ({ path: p, mtimeMs });

  it('keeps referenced files and reports unreferenced old ones', () => {
    const r = classifyUploads({
      files: [file('1/a-full.webp'), file('1/b-full.webp')],
      referencedPaths: ['1/a-full.webp'],
      now,
    });
    expect(r.referenced).toEqual(['1/a-full.webp']);
    expect(r.orphans).toEqual(['1/b-full.webp']);
    expect(r.tooYoung).toEqual([]);
  });

  it('never reports files younger than one day', () => {
    const r = classifyUploads({
      files: [
        file('1/new.webp', now - DAY_MS + 1000),
        file('1/old.webp', now - DAY_MS),
      ],
      referencedPaths: [],
      now,
    });
    expect(r.tooYoung).toEqual(['1/new.webp']);
    expect(r.orphans).toEqual(['1/old.webp']);
  });

  it('treats a file referenced by a soft-deleted image as referenced', () => {
    // The script passes the paths of all rows, deleted or not; the function
    // has no notion of deletedAt, so such paths are simply referenced.
    const r = classifyUploads({
      files: [file('1/gone-full.webp'), file('1/gone-thumb.webp')],
      referencedPaths: ['1/gone-full.webp', '1/gone-thumb.webp'],
      now,
    });
    expect(r.orphans).toEqual([]);
    expect(r.referenced).toHaveLength(2);
  });

  it('distinguishes thumb from full: only the referenced one is kept', () => {
    const r = classifyUploads({
      files: [file('1/a-full.webp'), file('1/a-thumb.webp')],
      referencedPaths: ['1/a-full.webp'],
      now,
    });
    expect(r.referenced).toEqual(['1/a-full.webp']);
    expect(r.orphans).toEqual(['1/a-thumb.webp']);
  });

  it('matches stored paths regardless of ./ prefix or backslashes', () => {
    const r = classifyUploads({
      files: [file('1/a-full.webp'), file('1/a-thumb.webp')],
      referencedPaths: ['./1/a-full.webp', '1\\a-thumb.webp'],
      now,
    });
    expect(r.orphans).toEqual([]);
  });

  it('works on the contents of a temporary directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orphan-uploads-'));
    try {
      mkdirSync(join(dir, '1'));
      for (const f of ['a-full.webp', 'a-thumb.webp', 'b-full.webp'])
        writeFileSync(join(dir, '1', f), 'x');
      const r = classifyUploads({
        files: readdirSync(join(dir, '1')).map((f) => file(`1/${f}`)),
        referencedPaths: ['1/a-full.webp', '1/a-thumb.webp'],
        now,
      });
      expect(r.orphans).toEqual(['1/b-full.webp']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
