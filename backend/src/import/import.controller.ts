import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ImportService } from './import.service';
import { DiscogsImportQueryDto } from './dto/discogs-import-query.dto';
import { DiscogsSearchQueryDto } from './dto/discogs-search-query.dto';

// No @Public() anywhere here — searching and importing are admin-only
// actions, same as a manual create, gated by the global AuthGuard.
@Controller('import/discogs')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Get('search')
  search(@Query() query: DiscogsSearchQueryDto) {
    return this.importService.search(query);
  }

  // POST, not GET: importing creates a vinyl (and artists, and images).
  // The session cookie is SameSite=Lax, which browsers still send on a
  // top-level GET navigation — so as a GET, any link the logged-in admin
  // followed could have created records.
  @Post(':releaseId')
  importRelease(
    @Param('releaseId', ParseIntPipe) releaseId: number,
    @Query() query: DiscogsImportQueryDto,
  ) {
    return this.importService.importRelease(releaseId, query.images ?? false);
  }
}
