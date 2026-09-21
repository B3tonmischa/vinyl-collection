import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ImportService } from './import.service';
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

  @Get(':releaseId')
  importRelease(@Param('releaseId', ParseIntPipe) releaseId: number) {
    return this.importService.importRelease(releaseId);
  }
}
