import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ArtistsService } from './artists.service';
import { CreateArtistDto } from './dto/create-artist.dto';
import { Public } from '../auth/public.decorator';

@Controller('artists')
export class ArtistsController {
  constructor(private readonly artistsService: ArtistsService) {}

  // Public, same as the vinyl gallery — this just backs the artist-name
  // search/autocomplete, and browsing it reveals nothing an admin-only guard
  // would need to protect.
  @Public()
  @Get()
  findAll(@Query('q') q?: string) {
    return this.artistsService.findAll(q);
  }

  // Admin-only: this is the "add new artist" half of the admin UI's
  // search-or-create picker, and it mutates data.
  @Post()
  create(@Body() dto: CreateArtistDto) {
    return this.artistsService.findOrCreate(dto.name);
  }
}
