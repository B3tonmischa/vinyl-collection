import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsServeController } from './uploads-serve.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController, UploadsServeController],
  providers: [UploadsService],
})
export class UploadsModule {}
