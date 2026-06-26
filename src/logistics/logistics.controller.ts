import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { ShiplogicWebhookDto } from './dto/shiplogic-webhook.dto';

@Controller('webhooks/shiplogic')
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

  @Post('tracking')
  @HttpCode(HttpStatus.OK) // Shiplogic expects an immediate 200/201 to halt re-delivery retries
  async handleTrackingWebhook(@Body() dto: ShiplogicWebhookDto) {
    // Hand off the tracking event data immediately to be processed in the background
    this.logisticsService.processTrackingEventBackground(dto).catch(err => {
      console.error(`❌ Background tracking update failure for ${dto.tracking_number}:`, err.message);
    });

    // Instantly return an acknowledgment response to release the external server connection thread
    return {
      received: true,
      timestamp: new Date().toISOString()
    };
  }
}