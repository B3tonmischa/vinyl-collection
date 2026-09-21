import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsServeController } from './uploads-serve.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController, UploadsServeController],
  providers: [UploadsService],
  // Exported so ImportModule can reuse the same image pipeline (resize,
  // WebP, per-kind/disc-number upsert) that a manual per-slot upload uses.
  exports: [UploadsService],
})
export class UploadsModule {}
