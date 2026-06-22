import { Module } from '@nestjs/common';
import { ConsignmentController } from './consignment.controller';

@Module({
  controllers: [
    ConsignmentController // Connects your bulk inventory spreadsheet ingest routes to the router
  ],
})
export class ConsignmentModule {}
