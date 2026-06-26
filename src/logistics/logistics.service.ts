import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ShiplogicWebhookDto } from './dto/shiplogic-webhook.dto';

@Injectable()
export class LogisticsService {
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
  ) {}

  /**
   * Processes the tracking event data asynchronously in the background.
   * This updates your database and logs the shipping milestones securely.
   */
  async processTrackingEventBackground(event: ShiplogicWebhookDto): Promise<void> {
    console.log(`🚚 Processing Shiplogic Milestone update for Tracking Reference: ${event.tracking_number} [${event.status_code}]`);

    // 1. Locate the active shipping assignment row using your tracking number parameter
    const { data: dispatchRecord, error: findError } = await this.supabase
      .from('auction_lot_dispatches')
      .select('id, invoice_id, delivery_status')
      .eq('tracking_number', event.tracking_number)
      .single();

    if (findError || !dispatchRecord) {
      console.warn(`⚠️ Shiplogic update skipped: Tracking reference ${event.tracking_number} does not match any active dispatch record.`);
      return;
    }

    // 2. Append the new courier milestone into your logistics historical audit table
    const { error: logError } = await this.supabase
      .from('logistics_milestone_logs')
      .insert({
        dispatch_id: dispatchRecord.id,
        status_code: event.status_code,
        status_text: event.status_text,
        carrier_name: event.carrier_name || 'Shiplogic Partner Network',
        recorded_at: new Date().toISOString(),
        raw_metadata: event.raw_payload || {}
      });

    if (logError) {
      console.error(`❌ Failed to write logistics milestone history row: ${logError.message}`);
    }

    // 3. Map Shiplogic status updates directly to your system's delivery stages
    let cleanStatusString = dispatchRecord.delivery_status;
    let triggerBuyerNotification = false;

    if (event.status_code === 'COLLECTED') {
      cleanStatusString = 'IN_TRANSIT';
      triggerBuyerNotification = true;
    } else if (event.status_code === 'OUT_FOR_DELIVERY') {
      cleanStatusString = 'OUT_FOR_DELIVERY';
      triggerBuyerNotification = true;
    } else if (event.status_code === 'DELIVERED') {
      cleanStatusString = 'DELIVERED';
      triggerBuyerNotification = true;
    }

    // 4. Update the high-level dispatch tracking status row inside your database
    if (cleanStatusString !== dispatchRecord.delivery_status) {
      await this.supabase
        .from('auction_lot_dispatches')
        .update({ 
          delivery_status: cleanStatusString,
          updated_at: new Date().toISOString()
        })
        .eq('id', dispatchRecord.id);

      // 5. Fire off zero-cost, automated transactional status update emails
      if (triggerBuyerNotification) {
        await this.dispatchTrackingStatusEmail(dispatchRecord.invoice_id, cleanStatusString, event.status_text);
      }
    }
  }

  /**
   * Logs a tracking status change event into the communication ledger to queue an email update.
   */
  private async dispatchTrackingStatusEmail(invoiceId: string, status: string, notes: string): Promise<void> {
    // Look up who owns this invoice to route the email address properly
    const { data: invoice } = await this.supabase
      .from('invoices')
      .select('buyer_id, id')
      .eq('id', invoiceId)
      .single();

    if (!invoice) return;

    // Queue an email notification entry into your system communication ledger table
    // Your email background worker handles sending the message securely
    await this.supabase
      .from('communication_delivery_queue')
      .insert({
        recipient_user_id: invoice.buyer_id,
        channel_type: 'EMAIL',
        template_identifier: 'SHIPPING_TRACKING_UPDATE',
        merge_fields: {
          invoice_id: invoiceId,
          delivery_status_slug: status,
          courier_milestone_notes: notes,
          triggered_timestamp: new Date().toISOString()
        }
      });

    console.log(`✉️ Queued tracking email notification update for Buyer UUID: ${invoice.buyer_id}`);
  }
}