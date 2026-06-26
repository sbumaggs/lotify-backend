import { Module } from '@nestjs/common';
import { ConsignmentController } from './consignment.controller';
import { ManifestProcessor } from './processors/manifest.processor';

@Module({
  controllers: [ConsignmentController],
  providers: [ManifestProcessor],
})
export class ConsignmentModule {}