import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';

export class ShiplogicWebhookDto {
  @IsString()
  @IsNotEmpty()
  tracking_number: string;

  @IsString()
  @IsNotEmpty()
  status_code: string;

  @IsString()
  @IsNotEmpty()
  status_text: string;

  @IsOptional()
  @IsString()
  carrier_name?: string;

  @IsObject()
  @IsOptional()
  raw_payload?: Record<string, any>;
}