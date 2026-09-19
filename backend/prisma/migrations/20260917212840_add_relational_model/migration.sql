/*
  Warnings:

  - You are about to drop the column `artist` on the `Vinyl` table. All the data in the column will be lost.
  - You are about to drop the column `format` on the `Vinyl` table. All the data in the column will be lost.
  - You are about to drop the column `tracklist` on the `Vinyl` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "VinylArtist" (
    "vinylId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,

    PRIMARY KEY ("vinylId", "artistId"),
    CONSTRAINT "VinylArtist_vinylId_fkey" FOREIGN KEY ("vinylId") REFERENCES "Vinyl" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VinylArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Track" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vinylId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "side" TEXT,
    CONSTRAINT "Track_vinylId_fkey" FOREIGN KEY ("vinylId") REFERENCES "Vinyl" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackArtist" (
    "trackId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,

    PRIMARY KEY ("trackId", "artistId"),
    CONSTRAINT "TrackArtist_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Vinyl" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "label" TEXT,
    "catalogNumber" TEXT,
    "releaseType" TEXT,
    "discSize" TEXT,
    "speed" TEXT,
    "genre" TEXT,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Vinyl" ("catalogNumber", "createdAt", "genre", "id", "label", "notes", "title", "updatedAt", "year") SELECT "catalogNumber", "createdAt", "genre", "id", "label", "notes", "title", "updatedAt", "year" FROM "Vinyl";
DROP TABLE "Vinyl";
ALTER TABLE "new_Vinyl" RENAME TO "Vinyl";
CREATE INDEX "Vinyl_title_idx" ON "Vinyl"("title");
CREATE TABLE "new_VinylImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "discNumber" INTEGER NOT NULL DEFAULT 1,
    "fullPath" TEXT NOT NULL,
    "thumbPath" TEXT NOT NULL,
    "vinylId" INTEGER NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VinylImage_vinylId_fkey" FOREIGN KEY ("vinylId") REFERENCES "Vinyl" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VinylImage" ("createdAt", "fullPath", "id", "kind", "thumbPath", "vinylId") SELECT "createdAt", "fullPath", "id", "kind", "thumbPath", "vinylId" FROM "VinylImage";
DROP TABLE "VinylImage";
ALTER TABLE "new_VinylImage" RENAME TO "VinylImage";
CREATE UNIQUE INDEX "VinylImage_vinylId_kind_discNumber_key" ON "VinylImage"("vinylId", "kind", "discNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Artist_name_key" ON "Artist"("name");

-- CreateIndex
CREATE INDEX "VinylArtist_artistId_idx" ON "VinylArtist"("artistId");

-- CreateIndex
CREATE INDEX "Track_vinylId_idx" ON "Track"("vinylId");

-- CreateIndex
CREATE INDEX "TrackArtist_artistId_idx" ON "TrackArtist"("artistId");
