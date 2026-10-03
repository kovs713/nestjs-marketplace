import { Module } from '@nestjs/common';

import { InventoryServiceController } from './inventory-service.controller.js';
import { InventoryServiceService } from './inventory-service.service.js';

@Module({
  imports: [],
  controllers: [InventoryServiceController],
  providers: [InventoryServiceService],
})
export class InventoryServiceModule {}
