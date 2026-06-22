import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import { PlaceBidDto } from './dto/place-bid.dto';

@Processor('bid-ingestion')
@Injectable()
export class AuctionProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionProcessor.name);
  private supabase;

  constructor() {
    super();
    // Service Role Initialization to cleanly execute database logic bypasses
    this.supabase = createClient(
      process.env.SUPABASE_URL || 'https://supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
    );
  }

  /**
   * BACKGROUND WORKER PROCESSOR: Consumes serialized jobs sequentially from BullMQ
   */
  async process(job: Job<PlaceBidDto, any, string>): Promise<any> {
    const data = job.data;
    this.logger.log(`Processing background bid ingestion for Lot: ${data.lotId}, Amount: R${data.amount}`);

    try {
      // 1. HARD-SET ON SUPABASE: Execute the atomic PostgreSQL transaction
      // This saves the raw bid, executes financial checks, and triggers the anti-snipe logic
      const { data: bidResult, error: bidError } = await this.supabase
        .from('bids')
        .insert({
          auction_lot_id: data.lotId,
          buyer_id: data.buyerId,
          amount: data.amount,
          max_bid_amount: data.amount, // Maps to system proxy parameters
          terms_accepted_at: data.termsAccepted ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (bidError) {
        this.logger.error(`Supabase Bid Insertion Rejected: ${bidError.message}`);
        throw new Error(`Database rejected transaction: ${bidError.message}`);
      }

      this.logger.log(`Bid Transaction successfully finalized on Supabase. Record ID: ${bidResult.id}`);
      return { success: true, bidId: bidResult.id };

    } catch (error: any) {
      this.logger.error(`Critical Pipeline Error on Job ${job.id}: ${error.message}`);
      throw error; // Triggers BullMQ retry mechanisms automatically
    }
  }
}
