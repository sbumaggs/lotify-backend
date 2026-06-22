import { Controller, Post, Body, HttpCode, HttpStatus, Logger, BadRequestException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Controller('webhooks/shiplogic')
export class ShiplogicController {
  private readonly logger = new Logger(ShiplogicController.name);
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || 'https://supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
    );
  }

  @Post('tracking')
  @HttpCode(HttpStatus.OK)
  async handleTrackingWebhook(@Body() payload: any) {
    this.logger.log(`Received tracking webhook ping from Shiplogic API`);

    const trackingReference = payload?.tracking_reference || payload?.waybill_number;
    const currentStatus = payload?.status?.code?.toUpperCase(); // e.g., 'OUT_FOR_DELIVERY', 'DELIVERED'

    if (!trackingReference || !currentStatus) {
      throw new BadRequestException('Malformed payload: tracking reference and status are required.');
    }

    // 1. HARD-SET ON SUPABASE: Locate the active tracking shipment record
    const { data: shipment, error: fetchError } = await this.supabase
      .from('shiplogic_shipments')
      .select('id, invoice_id')
      .eq('shiplogic_tracking_reference', trackingReference)
      .single();

    if (fetchError || !shipment) {
      this.logger.error(`Logistics Failure: Shipment reference ${trackingReference} not tracked in system database.`);
      throw new BadRequestException('Invalid tracking reference parameters.');
    }

    try {
      const timestampNow = new Date();

      if (currentStatus === 'DELIVERED') {
        // Compute precise 24-hour window extension expiration date
        const disputeExpiry = new Date(timestampNow.getTime() + 24 * 60 * 60 * 1000);

        // 2. ESCROW ENGINE RULE: Lock state adjustments into Supabase
        const { error: updateShipmentError } = await this.supabase
          .from('shiplogic_shipments')
          .update({
            current_delivery_status: 'DELIVERED',
            delivered_at: timestampNow.toISOString(),
            dispute_window_expires_at: disputeExpiry.toISOString(),
            updated_at: timestampNow.toISOString()
          })
          .eq('id', shipment.id);

        if (updateShipmentError) throw updateShipmentError;

        // Advance Invoice to DELIVERED status while keeping payout HELD
        const { error: updateInvoiceError } = await this.supabase
          .from('invoices')
          .update({
            status: 'DELIVERED',
            payout_status: 'HELD' // Explicitly remains HELD until 24 hours pass
          })
          .eq('id', shipment.invoice_id);

        if (updateInvoiceError) throw updateInvoiceError;

        this.logger.log(`Escrow Protection Active: Shipment ${trackingReference} marked DELIVERED. 24-Hour Dispute clock started.`);

      } else if (currentStatus === 'OUT_FOR_DELIVERY') {
        // Update Shiplogic mapping logs
        await this.supabase
          .from('shiplogic_shipments')
          .update({ current_delivery_status: 'OUT_FOR_DELIVERY', updated_at: timestampNow.toISOString() })
          .eq('id', shipment.id);

        // Advance baseline invoice carrier state 
        await this.supabase
          .from('invoices')
          .update({ status: 'OUT_FOR_DELIVERY' })
          .eq('id', shipment.invoice_id);

        this.logger.log(`Logistics Update: Shipment ${trackingReference} is OUT FOR DELIVERY. Alert queues flagged.`);
      }

      return { received: true, processedStatus: currentStatus };

    } catch (error: any) {
      this.logger.error(`Critical logistics pipeline exception: ${error.message}`);
      throw error;
    }
  }
}
