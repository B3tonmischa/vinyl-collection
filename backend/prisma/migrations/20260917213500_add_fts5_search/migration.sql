-- Hand-authored raw SQL migration: Prisma's schema.prisma cannot express a
-- SQLite virtual table, so this isn't generated from a schema.prisma diff
-- (there is no corresponding schema change) — apply with
-- `prisma migrate deploy`, not `migrate dev`.
--
-- Full-text index over title / label / artist names / track titles.
-- `artistNames` covers BOTH album-level artists (via VinylArtist) and each
-- track's *effective* artists (its own TrackArtist override, or — for a
-- track with no override — the album's artists it inherits): the UNION
-- below pulls in every artist reachable either way, so a search for a
-- guest artist who's credited on only one track still matches, without
-- needing a separate per-track artist column. genre and notes are
-- deliberately excluded (out of scope per the review).
CREATE VIRTUAL TABLE "vinyl_search" USING fts5(
  title,
  label,
  artistNames,
  trackTitles,
  tokenize = 'unicode61'
);

-- Backfill for any rows that existed before this migration ran. Later
-- writes are kept in sync by the triggers below.
INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
SELECT
  v."id",
  v."title",
  v."label",
  (
    SELECT group_concat(DISTINCT "name") FROM (
      SELECT a."name" AS "name"
      FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId"
      WHERE va."vinylId" = v."id"
      UNION
      SELECT a."name" AS "name"
      FROM "TrackArtist" ta
        JOIN "Artist" a ON a."id" = ta."artistId"
        JOIN "Track" t ON t."id" = ta."trackId"
      WHERE t."vinylId" = v."id"
    )
  ),
  (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
FROM "Vinyl" v
WHERE v."deletedAt" IS NULL;

-- ============================================================
-- Sync triggers
--
-- Every trigger below reduces to the same two statements — delete
-- whatever row is currently indexed for a vinylId, then (if that vinyl
-- still exists and isn't soft-deleted) reinsert a freshly recomputed row
-- for it. Because the re-insert's WHERE clause requires
-- `v."deletedAt" IS NULL`, a soft-deleted (or, for the Vinyl table's own
-- triggers, hard-deleted) vinyl simply has nothing to reinsert, which is
-- exactly "excluded from the index" — no separate branching needed.
-- ============================================================

-- ---- Vinyl ----

CREATE TRIGGER "vinyl_search_ai_vinyl" AFTER INSERT ON "Vinyl" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = NEW."id";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = NEW."id" AND v."deletedAt" IS NULL;
END;

CREATE TRIGGER "vinyl_search_au_vinyl" AFTER UPDATE ON "Vinyl" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = NEW."id";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = NEW."id" AND v."deletedAt" IS NULL;
END;

CREATE TRIGGER "vinyl_search_ad_vinyl" AFTER DELETE ON "Vinyl" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = OLD."id";
END;

-- ---- Track ----

CREATE TRIGGER "vinyl_search_ai_track" AFTER INSERT ON "Track" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = NEW."vinylId";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = NEW."vinylId" AND v."deletedAt" IS NULL;
END;

CREATE TRIGGER "vinyl_search_au_track" AFTER UPDATE ON "Track" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = OLD."vinylId";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = OLD."vinylId" AND v."deletedAt" IS NULL;

  DELETE FROM "vinyl_search" WHERE rowid = NEW."vinylId";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = NEW."vinylId" AND v."deletedAt" IS NULL;
END;

CREATE TRIGGER "vinyl_search_ad_track" AFTER DELETE ON "Track" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = OLD."vinylId";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = OLD."vinylId" AND v."deletedAt" IS NULL;
END;

-- ---- VinylArtist ----

CREATE TRIGGER "vinyl_search_ai_vinylartist" AFTER INSERT ON "VinylArtist" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = NEW."vinylId";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = NEW."vinylId" AND v."deletedAt" IS NULL;
END;

CREATE TRIGGER "vinyl_search_ad_vinylartist" AFTER DELETE ON "VinylArtist" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = OLD."vinylId";
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = OLD."vinylId" AND v."deletedAt" IS NULL;
END;

-- ---- TrackArtist (no vinylId column of its own — resolved via Track) ----

CREATE TRIGGER "vinyl_search_ai_trackartist" AFTER INSERT ON "TrackArtist" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = (SELECT "vinylId" FROM "Track" WHERE "id" = NEW."trackId");
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = (SELECT "vinylId" FROM "Track" WHERE "id" = NEW."trackId") AND v."deletedAt" IS NULL;
END;

CREATE TRIGGER "vinyl_search_ad_trackartist" AFTER DELETE ON "TrackArtist" BEGIN
  DELETE FROM "vinyl_search" WHERE rowid = (SELECT "vinylId" FROM "Track" WHERE "id" = OLD."trackId");
  INSERT INTO "vinyl_search" (rowid, title, label, artistNames, trackTitles)
  SELECT v."id", v."title", v."label",
    (SELECT group_concat(DISTINCT "name") FROM (
       SELECT a."name" AS "name" FROM "VinylArtist" va JOIN "Artist" a ON a."id" = va."artistId" WHERE va."vinylId" = v."id"
       UNION
       SELECT a."name" AS "name" FROM "TrackArtist" ta JOIN "Artist" a ON a."id" = ta."artistId" JOIN "Track" t ON t."id" = ta."trackId" WHERE t."vinylId" = v."id"
    )),
    (SELECT group_concat("title", ' ') FROM "Track" WHERE "vinylId" = v."id")
  FROM "Vinyl" v WHERE v."id" = (SELECT "vinylId" FROM "Track" WHERE "id" = OLD."trackId") AND v."deletedAt" IS NULL;
END;
