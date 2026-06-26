import { IsUUID, IsString, IsNotEmpty } from 'class-validator';

export class IngestManifestDto {
  @IsUUID('4', { message: 'A valid target auction_lot_id UUID must be supplied.' })
  auction_lot_id: string;

  @IsString({ message: 'The manifest storage object path must be a valid string reference.' })
  @IsNotEmpty({ message: 'The manifest file path pointer cannot be left blank.' })
  storage_object_path: string;
}