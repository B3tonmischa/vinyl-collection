// Usage (inside the backend container, from /app):
//   node scripts/find-orphan-uploads.js            # dry run, only prints
//   node scripts/find-orphan-uploads.js --delete   # also removes the orphans
//
// Lists files under the uploads root that no VinylImage row references via
// fullPath or thumbPath. Soft-deleted rows count as references. Files
// younger than one day are always skipped. See DEPLOYMENT.md.
const fs = require('node:fs');
const path = require('node:path');
const { classifyUploads } = require('./orphan-uploads');

// Same resolution as getUploadsRoot() in src/uploads/uploads.service.ts.
function getUploadsRoot() {
  return process.env.UPLOADS_ROOT
    ? path.join(process.env.UPLOADS_ROOT)
    : path.join(process.cwd(), 'uploads');
}

// Regular files only. Symlinks (to files or directories) are never followed
// or reported, so nothing outside the uploads root can be reached.
function listFiles(root, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), {
    withFileTypes: true,
  })) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, entryRel));
    else if (entry.isFile()) {
      const { mtimeMs } = fs.lstatSync(path.join(root, entryRel));
      out.push({ path: entryRel, mtimeMs });
    }
  }
  return out;
}

// Re-checks right before deleting: still a plain file, real path in the root.
function safeDelete(root, rel) {
  const target = path.join(root, rel);
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) return false;
  const relToRoot = path.relative(
    fs.realpathSync(root),
    fs.realpathSync(target),
  );
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return false;
  fs.unlinkSync(target);
  return true;
}

async function loadReferencedPaths() {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const { PrismaClient } = require('../dist/generated/prisma/client');
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
    }),
  });
  try {
    // No deletedAt filter on purpose: soft-deleted images still own files.
    const rows = await prisma.vinylImage.findMany({
      select: { fullPath: true, thumbPath: true },
    });
    return {
      rowCount: rows.length,
      paths: rows.flatMap((r) => [r.fullPath, r.thumbPath]),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--delete');
  if (unknown.length) {
    console.error(
      `Unknown argument(s): ${unknown.join(' ')}\nUsage: node scripts/find-orphan-uploads.js [--delete]`,
    );
    process.exit(1);
  }
  const doDelete = args.includes('--delete');

  const root = getUploadsRoot();
  if (!fs.existsSync(root)) {
    console.error(`Uploads root not found: ${root}`);
    process.exit(1);
  }
  console.log(`Uploads root: ${root}`);

  const { rowCount, paths } = await loadReferencedPaths();
  const files = listFiles(root);
  const { referenced, orphans, tooYoung } = classifyUploads({
    files,
    referencedPaths: paths,
    now: Date.now(),
  });

  console.log(`Image rows: ${rowCount} (soft-deleted included)`);
  console.log(
    `Files: ${files.length} | referenced: ${referenced.length} | too young (<1 day, skipped): ${tooYoung.length} | orphaned: ${orphans.length}`,
  );
  for (const o of orphans) console.log(`  orphan: ${o}`);

  if (!doDelete) {
    if (orphans.length)
      console.log(
        'Dry run - nothing deleted. Back up data/ first, then re-run with --delete.',
      );
    return;
  }
  // A wrong DATABASE_URL would make every file look orphaned.
  if (rowCount === 0 && files.length > 0) {
    console.error(
      'Refusing to delete: the database has no image rows but the uploads folder has files. Check DATABASE_URL.',
    );
    process.exit(1);
  }
  let deleted = 0;
  for (const o of orphans) {
    if (safeDelete(root, o)) deleted++;
    else console.warn(`  skipped (not a plain file inside the root): ${o}`);
  }
  console.log(`Deleted ${deleted} file(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
