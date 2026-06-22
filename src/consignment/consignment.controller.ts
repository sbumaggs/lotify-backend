import { Controller, Post, Body, BadRequestException, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Controller('consignment')
export class ConsignmentController {
  private readonly logger = new Logger(ConsignmentController.name);
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || 'https://supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
    );
  }

  @Post('ingest')
  @HttpCode(HttpStatus.CREATED)
  async ingestConsignmentCargo(@Body() payload: any) {
    this.logger.log(`Received bulk consignment inventory ingestion request`);

    const { lotId, weightKg, packageType, packageDimensions, inventoryLines } = payload;

    // 1. INPUT SANITY VALIDATION FIREWALL
    if (!lotId || !weightKg || !packageType || !Array.isArray(inventoryLines)) {
      throw new BadRequestException('Malformed request: lotId, weightKg, packageType, and inventoryLines array are mandatory.');
    }

    try {
      // 2. HARD-SET ON SUPABASE: Update the core shipping parameters on the target lot row
      const { error: lotUpdateError } = await this.supabase
        .from('auction_lots')
        .update({
          weight_kg: weightKg,
          package_type: packageType,
          package_dimensions_json: packageDimensions || { length_cm: 0, width_cm: 0, height_cm: 0 },
          updated_at: new Date().toISOString()
        })
        .eq('id', lotId);

      if (lotUpdateError) {
        this.logger.error(`Failed to update auction lot logistics specs: ${lotUpdateError.message}`);
        throw new BadRequestException(`Database rejected lot update: ${lotUpdateError.message}`);
      }

      // 3. MAP MATRIX: Format raw line inputs to fit your consignment_inventory_lines schema rules
      const bulkLinesToInsert = inventoryLines.map((line: any) => ({
        auction_lot_id: lotId,
        item_description: line.description,
        quantity: parseInt(line.quantity, 10) || 1,
        unit_msrp: parseFloat(line.unitMsrp) || 0.00,
        condition_tag: line.conditionTag || 'Returns',
        model_or_sku: line.sku || null,
        product_upc_asin: line.upcAsin || null
      }));

      // 4. BULK BULLET WRITE: Direct injection of all spreadsheet lines into the database
      const { data: insertedRecords, error: batchInsertError } = await this.supabase
        .from('consignment_inventory_lines')
        .insert(bulkLinesToInsert)
        .select('id');

      if (batchInsertError) {
        this.logger.error(`Bulk inventory insertion transaction aborted: ${batchInsertError.message}`);
        throw new BadRequestException(`Database rejected manifest processing: ${batchInsertError.message}`);
      }

      this.logger.log(`Success: Loaded ${insertedRecords.length} item records into Lot consignment ledger.`);
      return { success: true, processedItemCount: insertedRecords.length };

    } catch (error: any) {
      this.logger.error(`Critical consignment engine pipeline breakdown: ${error.message}`);
      throw error;
    }
  }
}
