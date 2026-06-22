import { Module } from '@nestjs/common';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { BullModule } from '@nestjs/bullmq';
import { AuctionModule } from './auction/auction.module';
import { LogisticsModule } from './logistics/logistics.module';
import { ConsignmentModule } from './consignment/consignment.module'; // Import your consignment module here

@Module({
  imports: [
    RedisModule.forRoot({
      config: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    AuctionModule,
    LogisticsModule,
    ConsignmentModule, // Mount the consignment cargo processing engine to complete your app imports
  ],
})
export class AppModule {}
