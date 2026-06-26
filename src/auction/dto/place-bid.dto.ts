import { IsUUID, IsNumber, IsPositive, IsBoolean, IsOptional } from 'class-validator';

export class PlaceBidDto {
  @IsUUID('4', { message: 'A valid auction_lot_id UUID must be provided.' })
  auction_lot_id: string;

  @IsUUID('4', { message: 'A valid buyer_id UUID must be provided.' })
  buyer_id: string;

  @IsNumber({}, { message: 'Bid amount must be a precise numeric representation.' })
  @IsPositive({ message: 'Bid amount must be greater than zero.' })
  amount: number;

  @IsNumber({}, { message: 'Maximum proxy bid limit must be a precise numeric representation.' })
  @IsPositive({ message: 'Maximum proxy bid limit must be greater than zero.' })
  @IsOptional()
  max_bid_amount?: number;

  @IsBoolean({ message: 'Terms and conditions acknowledgment must be explicitly stated.' })
  terms_accepted: boolean;
}