import { Controller, Post, Body, Inject, HttpCode, HttpStatus } from '@nestjs/common';
import { IngestManifestDto } from './dto/ingest-manifest.dto';
import { Queue } from 'bullmq';

@Controller('consignment')
export class ConsignmentController {
  private consignmentQueue: Queue;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: any) {
    // Initialize the BullMQ Job Queue bound to our Cloud Redis Instance
    this.consignmentQueue = new Queue('consignment-ingestion-queue', {
      connection: this.redis,
    });
  }

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerBulkIngestion(@Body() dto: IngestManifestDto) {
    // Push the heavy parsing work directly into the Redis asynchronous queue
    const job = await this.consignmentQueue.add('process-manifest-spreadsheet', {
      auction_lot_id: dto.auction_lot_id,
      storage_object_path: dto.storage_object_path,
    }, {
      attempts: 3, // Automatically retry 3 times if a network blip occurs
      backoff: {
        type: 'exponential',
        delay: 5000, // Wait 5s, then 10s, then 20s between failures
      },
    });

    return {
      status: 'QUEUED',
      message: 'The manifest has been accepted for background processing.',
      jobId: job.id,
    };
  }
}