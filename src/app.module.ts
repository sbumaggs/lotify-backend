import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule'; 
import { AuctionModule } from './auction/auction.module';
import { ConsignmentModule } from './consignment/consignment.module';
import { LogisticsModule } from './logistics/logistics.module';
import { DatabaseModule } from './database/database.module';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(), // ◄— Initialized runtime scheduling runners engine globally
    DatabaseModule, 
    AuctionModule,
    ConsignmentModule,
    LogisticsModule,
  ],
  providers: [
    {
      provide: 'SUPABASE_CLIENT',
      useFactory: (configService: ConfigService) => {
        return createClient(
          configService.get<string>('SUPABASE_URL'),
          configService.get<string>('SUPABASE_SERVICE_ROLE_KEY'),
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        );
      },
      inject: [ConfigService],
    },
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new Redis({
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT') || 6379,
          password: configService.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: null,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: ['SUPABASE_CLIENT', 'REDIS_CLIENT'],
})
export class AppModule {}