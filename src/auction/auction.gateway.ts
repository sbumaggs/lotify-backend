import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, UsePipes, ValidationPipe } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { DatabaseCacheService } from '../database/database-cache.service';
import { PlaceBidDto } from './dto/place-bid.dto';
import Redis from 'ioredis';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class AuctionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly cacheService: DatabaseCacheService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`💡 Client connected to Live Auction Gateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`❌ Client disconnected from Live Auction Gateway: ${client.id}`);
  }

  /**
   * ⚡ HIGH-SPEED ATOMIC CONCURRENCY BIDDING PIPELINE
   */
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @SubscribeMessage('placeBid')
  async handlePlaceBid(
    @MessageBody() data: PlaceBidDto,
    @ConnectedSocket() client: Socket,
  ) {
    const { auction_lot_id, buyer_id, amount } = data;
    const lockKey = `lock:lot:${auction_lot_id}`;
    
    // Acquire distributed Redis microsecond lock
    const acquiredLock = await this.redis.set(lockKey, 'LOCK', 'PX', 500, 'NX');
    
    if (!acquiredLock) {
      client.emit('bidException', {
        status: 'CONCURRENCY_FAIL',
        message: 'High traffic detected. Your bid clashed with another bidder. Retrying instantly...',
      });
      return;
    }

    try {
      // 1. Resolve dynamic operational configurations from Redis cache layer
      const settings = await this.cacheService.getCachedSettings();

      // 2. Fetch current targeting lot profile directly from Supabase
      const { data: lot, error: lotErr } = await this.supabase
        .from('auction_lots')
        .select('id, status, end_time, reserve_price')
        .eq('id', auction_lot_id)
        .single();

      if (lotErr || !lot) {
        throw new Error('Target auction lot record could not be localized in the system.');
      }

      // 3. Status Gates validation
      if (lot.status !== 'LIVE') {
        throw new Error('Bidding window is closed for this specific auction lot.');
      }

      if (new Date() > new Date(lot.end_time)) {
        throw new Error('The designated closing time for this auction lot has already elapsed.');
      }

      // 4. Determine next valid bid threshold using the dynamic increment matrix
      const currentLeadingBid = await this.redis.get(`lot:${auction_lot_id}:high_bid`);
      const activeHighValue = currentLeadingBid ? Number(currentLeadingBid) : Number(lot.reserve_price || 0);
      const requiredIncrement = await this.cacheService.getRequiredIncrementForValue(activeHighValue);

      if (amount < (activeHighValue + requiredIncrement)) {
        throw new Error(`Insufficient amount. Next valid structural bid must be at least R${activeHighValue + requiredIncrement}.`);
      }

      // 5. Insert bid entry directly into your database schema
      const { data: newBid, error: bidErr } = await this.supabase
        .from('bids')
        .insert({
          auction_lot_id: auction_lot_id,
          buyer_id: buyer_id,
          amount: amount,
          terms_accepted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (bidErr) throw new Error(`Database state rejection: ${bidErr.message}`);

      // 6. Execute Anti-Snipe Calculation Process
      const antiSnipeWindowMs = settings.anti_snipe_window_minutes * 60 * 1000;
      const extensionMs = settings.anti_snipe_extension_minutes * 60 * 1000;
      const lotEndTime = new Date(lot.end_time).getTime();
      const timeRemainingMs = lotEndTime - Date.now();

      let finalEndTime = lot.end_time;

      if (timeRemainingMs <= antiSnipeWindowMs) {
        const calculateExtendedTime = new Date(lotEndTime + extensionMs).toISOString();
        
        // Push extended time parameter down to your exact schema column
        await this.supabase
          .from('auction_lots')
          .update({ end_time: calculateExtendedTime })
          .eq('id', auction_lot_id);
          
        finalEndTime = calculateExtendedTime;

        // Log compliance audit row into auction_lot_bid_events
        await this.supabase.from('auction_lot_bid_events').insert({
          auction_lot_id: auction_lot_id,
          bid_id: newBid.id,
          event_type: 'ANTI_SNIPE_EXTENSION',
          extension_minutes_applied: settings.anti_snipe_extension_minutes,
          previous_end_time: lot.end_time,
          new_end_time: calculateExtendedTime,
        });
      }

      // 7. Update real-time price state cache instantly
      await this.redis.set(`lot:${auction_lot_id}:high_bid`, amount.toString());

      // 8. Stream the updated state down to your Next.js clients over socket lines
      this.server.emit(`lotUpdate:${auction_lot_id}`, {
        currentHighBid: amount,
        leadingBuyerId: buyer_id,
        endTime: finalEndTime,
      });

      // Confirm success back to the thread caller
      client.emit('bidSuccess', { bidId: newBid.id, amount });

    } catch (error: any) {
      client.emit('bidException', {
        status: 'VALIDATION_REJECTION',
        message: error.message || 'An unhandled operational logic failure occurred.',
      });
    } finally {
      // Always unlock the concurrency gate
      await this.redis.del(lockKey);
    }
  }
}