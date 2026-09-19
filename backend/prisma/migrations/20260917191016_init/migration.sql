-- CreateTable
CREATE TABLE "Vinyl" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "label" TEXT,
    "catalogNumber" TEXT,
    "format" TEXT,
    "genre" TEXT,
    "tracklist" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VinylImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "fullPath" TEXT NOT NULL,
    "thumbPath" TEXT NOT NULL,
    "vinylId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VinylImage_vinylId_fkey" FOREIGN KEY ("vinylId") REFERENCES "Vinyl" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Vinyl_artist_idx" ON "Vinyl"("artist");

-- CreateIndex
CREATE INDEX "Vinyl_title_idx" ON "Vinyl"("title");

-- CreateIndex
CREATE UNIQUE INDEX "VinylImage_vinylId_kind_key" ON "VinylImage"("vinylId", "kind");
