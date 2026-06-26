import { Module, Global } from '@nestjs/common';
import { DatabaseCacheService } from './database-cache.service';

@Global()
@Module({
  providers: [DatabaseCacheService],
  exports: [DatabaseCacheService],
})
export class DatabaseModule {}