// src/auction/services/auction-enforcement.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class AuctionEnforcementService {
  private readonly logger = new Logger(AuctionEnforcementService.name);
  private supabase;

  constructor() {
    // Initialize standard administrative system client using your environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      this.logger.error('Missing Supabase environment variables for administrative system bypass!');
    }

    // Service role key bypasses Row Level Security (RLS) policies for clean cron updates
    this.supabase = createClient(supabaseUrl || '', supabaseServiceKey || '');
  }

  // Runs automatically on the hour, every hour, to monitor late payments
  @Cron(CronExpression.EVERY_HOUR)
  async handleUnpaidAuctionCleanups() {
    this.logger.log('Starting hourly 24-hour auction settlement enforcement sweep...');

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // 1. Scan for closed, unpaid lots whose settlement window expired
    const { data: expiredLots, error: fetchError } = await this.supabase
      .from('auctions')
      .select('id, title, leading_buyer_id, final_price, lot_number')
      .eq('status', 'CLOSED')
      .eq('payment_status', 'UNPAID')
      .lte('end_time', twentyFourHoursAgo.toISOString());

    if (fetchError) {
      this.logger.error(`Failed to pull delinquent auction rows: ${fetchError.message}`);
      return;
    }

    if (!expiredLots || expiredLots.length === 0) {
      this.logger.log('Sweep complete. No unpaid liquidation balances past the 24-hour mark detected.');
      return;
    }

    // 2. Loop through all delinquent balances and process penalties atomically
    for (const lot of expiredLots) {
      if (!lot.leading_buyer_id) continue;

      this.logger.warn(`Processing default penalties on Lot #${lot.lot_number} for Buyer: ${lot.leading_buyer_id}`);

      try {
        // Fetch current corporate history track profile
        const { data: profile, error: profileFetchErr } = await this.supabase
          .from('corporate_profiles')
          .select('payment_strike_count, company_name')
          .eq('id', lot.leading_buyer_id)
          .single();

        if (profileFetchErr) throw profileFetchErr;

        const currentStrikes = profile.payment_strike_count || 0;
        const newStrikeCount = currentStrikes + 1;
        const shouldSuspend = newStrikeCount >= 3;

        // Apply strike penalty row update
        const { error: profileUpdateErr } = await this.supabase
          .from('corporate_profiles')
          .update({
            payment_strike_count: newStrikeCount,
            account_status: shouldSuspend ? 'SUSPENDED' : 'ACTIVE'
          })
          .eq('id', lot.leading_buyer_id);

        if (profileUpdateErr) throw profileUpdateErr;

        if (shouldSuspend) {
          this.logger.error(`CRITICAL ACCOUNT LOCK: Firm "${profile.company_name}" has been SUSPENDED due to 3 non-payment strikes.`);
        }

        // 3. Reset lot state and drop it cleanly back down onto the Cargo Discovery Floor (Option B)
        const freshAuctionExpiry = new Date();
        freshAuctionExpiry.setHours(freshAuctionExpiry.getHours() + 48); // Relist live for a fresh 48-hour cycle

        const { error: lotResetErr } = await this.supabase
          .from('auctions')
          .update({
            status: 'ACTIVE',
            payment_status: 'PENDING',
            leading_buyer_id: null,
            current_high_bid: null,
            end_time: freshAuctionExpiry.toISOString()
          })
          .eq('id', lot.id);

        if (lotResetErr) throw lotResetErr;

        this.logger.log(`Lot #${lot.lot_number} ("${lot.title}") has been stripped of default bids and re-listed successfully.`);

      } catch (err: any) {
        this.logger.error(`Failed executing transaction reversals on Lot ID ${lot.id}: ${err.message}`);
      }
    }
  }
}