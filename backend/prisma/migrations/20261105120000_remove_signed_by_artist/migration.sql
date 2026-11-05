-- Hand-authored: a plain DROP COLUMN keeps the Vinyl table (and the
-- vinyl_search FTS5 sync triggers attached to it) intact, where a
-- generated table redefine would drop them.
ALTER TABLE "Vinyl" DROP COLUMN "signedByArtist";
