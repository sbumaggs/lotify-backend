import { IsUUID, IsNumber, IsPositive, IsBoolean } from 'class-validator';

export class PlaceBidDto {
  @IsUUID()
  lotId!: string;

  @IsUUID()
  buyerId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsBoolean()
  termsAccepted!: boolean;
}
