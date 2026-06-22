import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuctionGateway } from './auction.gateway';
import { AuctionProcessor } from './auction.processor';

@Module({
  imports: [
    // Register the exact background queue namespace the gateway uses to hand off jobs
    BullModule.registerQueue({
      name: 'bid-ingestion',
    }),
  ],
  providers: [
    AuctionGateway,   // Runs the live WebSocket server with Redis SETNX locks
    AuctionProcessor, // Runs the background worker pipeline to feed Supabase
  ],
})
export class AuctionModule {}
