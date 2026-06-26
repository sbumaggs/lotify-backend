import { Module } from '@nestjs/common';
import { AuctionGateway } from './getways/auction.gateway';

@Module({
  providers: [AuctionGateway],
})
export class AuctionModule {}