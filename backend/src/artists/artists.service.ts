import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ArtistsService {
  constructor(private readonly prisma: PrismaService) {}

  // Search-as-you-type for the admin UI's artist picker. SQLite's LIKE
  // (what Prisma's `contains` compiles to here) is case-insensitive for
  // ASCII by default, so this doubles as a case-insensitive search without
  // any extra work.
  findAll(search?: string) {
    return this.prisma.artist.findMany({
      where: search ? { name: { contains: search } } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  // Idempotent create: SQLite's UNIQUE on Artist.name is case-sensitive, so
  // "Radiohead" and "radiohead" wouldn't collide at the DB level. To avoid
  // silent near-duplicates from the admin UI's "add new artist" flow, this
  // does its own case-insensitive lookup first and returns the existing row
  // instead of creating a new one when the name already exists in any case.
  async findOrCreate(name: string) {
    const trimmed = name.trim();
    const candidates = await this.prisma.artist.findMany({
      where: { name: { contains: trimmed } },
    });
    const existing = candidates.find(
      (artist) => artist.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      return existing;
    }
    return this.prisma.artist.create({ data: { name: trimmed } });
  }
}
