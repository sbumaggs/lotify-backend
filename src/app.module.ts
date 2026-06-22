import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { BullModule } from '@nestjs/bullmq';
import { AuctionModule } from './auction/auction.module';
import { LogisticsModule } from './logistics/logistics.module';
import { ConsignmentModule } from './consignment/consignment.module';

@Module({
  imports: [
    // 1. Force NestJS to load your local .env file globally into memory
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. Initialize Global High-Speed Cloud Redis Service dynamically
    RedisModule.forRoot({
      config: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        // Since Upstash uses standard TLS/SSL for secure cloud data, force secure connections
        tls: process.env.REDIS_HOST?.includes('upstash.io') ? {} : undefined,
      },
    }),

    // 3. Initialize Global BullMQ Background Processing Pipeline dynamically
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_HOST?.includes('upstash.io') ? {} : undefined,
      },
    }),

    // 4. Mount your core bidding and inventory engine feature pipelines
    AuctionModule,
    LogisticsModule,
    ConsignmentModule,
  ],
})
export class AppModule {}
