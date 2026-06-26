import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Redis from 'ioredis';

@Injectable()
export class DatabaseCacheService implements OnModuleInit {
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  // Automatically runs when the NestJS application boots up from scratch
  async onModuleInit() {
    console.log('🔄 Initializing system configuration parameters from Supabase...');
    await this.refreshPlatformSettingsCache();
    await this.refreshBidIncrementsCache();
  }

  /**
   * Fetches latest row from platform_settings and caches it as a Redis JSON string
   */
  async refreshPlatformSettingsCache(): Promise<any> {
    const { data, error } = await this.supabase
      .from('platform_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.error('❌ Failed to pull platform_settings from Supabase:', error?.message);
      throw new Error('Critical Platform Parameter Configuration Missing');
    }

    // Cache the settings object globally in Redis for microsecond lookup speeds
    await this.redis.set('config:platform_settings', JSON.stringify(data));
    console.log('✅ Synchronized platform settings cache successfully.');
    return data;
  }

  /**
   * Fetches the entire bid increments matrix and caches it in Redis
   */
  async refreshBidIncrementsCache(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('bid_increments')
      .select('*')
      .order('range_min', { ascending: true });

    if (error || !data) {
      console.error('❌ Failed to pull bid_increments matrix from Supabase:', error?.message);
      throw new Error('Critical Bidding Matrix Configuration Missing');
    }

    await this.redis.set('config:bid_increments', JSON.stringify(data));
    console.log(`✅ Synchronized ${data.length} bid increment threshold steps.`);
    return data;
  }

  /**
   * Helper utility to quickly extract running configurations in application execution blocks
   */
  async getCachedSettings(): Promise<any> {
    const raw = await this.redis.get('config:platform_settings');
    return raw ? JSON.parse(raw) : await this.refreshPlatformSettingsCache();
  }

  /**
   * Helper utility to calculate the exact South African bid increment required on a lot
   */
  async getRequiredIncrementForValue(currentValue: number): Promise<number> {
    const raw = await this.redis.get('config:bid_increments');
    const increments = raw ? JSON.parse(raw) : await this.refreshBidIncrementsCache();

    for (const rule of increments) {
      const min = Number(rule.range_min);
      const max = rule.range_max ? Number(rule.range_max) : Infinity;
      
      if (currentValue >= min && currentValue < max) {
        return Number(rule.increment_amount);
      }
    }
    return 50; // Fallback minimum ZAR increment step if array is empty
  }
}