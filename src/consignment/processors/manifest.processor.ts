import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ManifestProcessor implements OnModuleInit {
  private worker: Worker;

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    @Inject('REDIS_CLIENT') private readonly redis: any,
  ) {}

  onModuleInit() {
    // Instantiate the real background loop checking for available tasks in Redis
    this.worker = new Worker(
      'consignment-ingestion-queue',
      async (job: Job) => {
        await this.processJob(job);
      },
      { connection: this.redis, concurrency: 1 }, // Concurrency 1 keeps system memory footprint completely safe
    );

    this.worker.on('completed', (job) => console.log(`✨ Ingestion Job ${job.id} completed successfully.`));
    this.worker.on('failed', (job, err) => console.error(`❌ Ingestion Job ${job?.id} failed: ${err.message}`));
  }

  private async processJob(job: Job) {
    const { auction_lot_id, storage_object_path } = job.data;
    console.log(`🚀 Worker Processing Job ${job.id} for Lot UUID: ${auction_lot_id}`);

    // 1. Download the raw CSV data from your public/private Supabase Storage Bucket
    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from('lot_manifests')
      .download(storage_object_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to retrieve file from Supabase storage: ${downloadError?.message}`);
    }

    const rawCsvText = await fileData.text();
    const rows = rawCsvText.split('\n').map(row => row.trim()).filter(row => row.length > 0);
    
    // Extract headers from the first row of your spreadsheet upload
    const headers = rows.shift()?.split(',').map(h => h.trim().replace(/"/g, '')) || [];

    let totalLotMsrp = 0;

    // 2. Loop through each item line inside the manifest spreadsheet array
    for (const row of rows) {
      const columns = row.split(',').map(c => c.trim().replace(/"/g, ''));
      if (columns.length < headers.length) continue; // Skip incomplete or corrupted data lines safely

      // Map spreadsheet positions cleanly to your table column fields
      const item_description = columns[0];
      const quantity = parseInt(columns[1], 10) || 1;
      const unit_msrp = parseFloat(columns[2]) || 0;
      const condition_tag = columns[3] || 'UNTESTED_RETURNS';
      const model_or_sku = columns[4] || null;
      const product_upc_asin = columns[5] || null;

      const total_msrp = quantity * unit_msrp;
      totalLotMsrp += total_msrp;

      // 3. Store row information directly inside your consignment_inventory_lines schema
      const { error: lineError } = await this.supabase
        .from('consignment_inventory_lines')
        .insert({
          auction_lot_id,
          item_description,
          quantity,
          unit_msrp,
          total_msrp,
          condition_tag,
          model_or_sku,
          product_upc_asin,
        });

      if (lineError) {
        console.error(`Skipped an unstable manifest row entry: ${lineError.message}`);
        continue; // Continue processing the rest of the lines even if one row fails
      }
    }

    // 4. Update the high-level metrics on the auction lot parent table row
    await this.supabase
      .from('auction_lots')
      .update({
        msrp: totalLotMsrp,
        items: { processed_total_lines: rows.length, parsed_at: new Date().toISOString() }
      })
      .eq('id', auction_lot_id);

    console.log(`🎉 Processed ${rows.length} lines. Total computed MSRP added: R${totalLotMsrp}`);
  }
}