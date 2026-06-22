import { 
  WebSocketGateway, 
  WebSocketServer, 
  SubscribeMessage, 
  MessageBody, 
  ConnectedSocket,
  WsException 
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, UsePipes, ValidationPipe } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import { PlaceBidDto } from './dto/place-bid.dto';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'auction',
})
@Injectable()
export class AuctionGateway {
  @WebSocketServer() server!: Server;
  private supabase;

  constructor(
    private readonly redisService: RedisService,
    @InjectQueue('bid-ingestion') private readonly bidQueue: Queue,
  ) {
    this.supabase = createClient(
      process.env.SUPABASE_URL || 'https://supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
    );
  }

  @UsePipes(new ValidationPipe())
  @SubscribeMessage('place_bid')
  async handlePlaceBid(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: PlaceBidDto,
  ) {
    // Retrieve the underlying safe Redis client instance using the service manager
    const redis = this.redisService.getOrThrow();
    const lockKey = `lock:lot:${data.lotId}`;
    const clientId = client.id;

    // 1. CONCURRENCY INSURANCE: Acquire lock using modern type-safe option parameters
    const lockAcquired = await redis.set(lockKey, clientId, 'PX', 3000, 'NX');

    if (!lockAcquired) {
      throw new WsException('Bid processing is underway. Please try again.');
    }

    try {
      const cachedHighBidKey = `cache:lot:${data.lotId}:high_bid`;
      const currentHighestCached = await redis.get(cachedHighBidKey);

      if (currentHighestCached && data.amount <= parseFloat(currentHighestCached)) {
        throw new WsException('Bid Rejected: A higher or equal bid has already been registered.');
      }

      await redis.set(cachedHighBidKey, data.amount.toString());

      await this.bidQueue.add('process-bid-job', data, {
        attempts: 3,
        backoff: 1000,
        removeOnComplete: true,
      });

      client.emit('bid_accepted_optimistic', {
        lotId: data.lotId,
        amount: data.amount,
      });

    } catch (error: any) {
      client.emit('bid_failed', { message: error.message || 'Transaction failed.' });
    } finally {
      const luaReleaseScript = `
        if redis.call("get", KEYS) == ARGV then
            return redis.call("del", KEYS)
        else
            return 0
        end
      `;
      await redis.eval(luaReleaseScript, 1, lockKey, clientId);
    }
  }
}
