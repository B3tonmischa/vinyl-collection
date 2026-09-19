import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { VinylsService } from './vinyls.service';
import { CreateVinylDto } from './dto/create-vinyl.dto';
import { UpdateVinylDto } from './dto/update-vinyl.dto';
import { Public } from '../auth/public.decorator';

@Controller('vinyls')
export class VinylsController {
  constructor(private readonly vinylsService: VinylsService) {}

  @Public()
  @Get()
  findAll(@Query('q') q?: string) {
    return this.vinylsService.findAll(q);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.vinylsService.findOne(id);
  }

  // Everything below has no @Public() — the global guard requires an admin session.
  @Post()
  create(@Body() dto: CreateVinylDto) {
    return this.vinylsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVinylDto) {
    return this.vinylsService.update(id, dto);
  }

  // Soft delete — hides the record from list/detail/search, but the row
  // (and its images/tracks) survive for restore().
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.vinylsService.remove(id);
  }

  // Undo — no "list deleted items" view is needed, this is meant to back an
  // immediate "Undo" affordance right after a delete.
  @Post(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.vinylsService.restore(id);
  }
}
