import { Module } from '@nestjs/common';
import { ShiplogicController } from './shiplogic.controller';

@Module({
  controllers: [
    ShiplogicController // Hooks your multi-carrier tracking listener endpoint into the app router
  ],
})
export class LogisticsModule {}
