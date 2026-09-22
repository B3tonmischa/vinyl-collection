-- Hand-authored: VinylImage.kind is stored as plain TEXT with no CHECK
-- constraint on SQLite (see 20260917212840_add_relational_model), so
-- renaming an ImageKind enum value is a data migration only — there is no
-- corresponding DDL change for `prisma migrate diff` to generate.
--
-- Gatefold releases can have two independent inner sleeves. INNER_SLEEVE is
-- replaced by INNER_SLEEVE_A / INNER_SLEEVE_B; existing rows move to slot A
-- so they keep displaying exactly where they already were.
UPDATE "VinylImage" SET "kind" = 'INNER_SLEEVE_A' WHERE "kind" = 'INNER_SLEEVE';
