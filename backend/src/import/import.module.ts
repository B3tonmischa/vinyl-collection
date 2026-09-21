import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { DiscogsClient } from './discogs-client';
import { ArtistsModule } from '../artists/artists.module';
import { VinylsModule } from '../vinyls/vinyls.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [ArtistsModule, VinylsModule, UploadsModule],
  controllers: [ImportController],
  providers: [ImportService, DiscogsClient],
})
export class ImportModule {}
