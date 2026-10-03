import { Controller, Get } from '@nestjs/common';

import { InventoryServiceService } from './inventory-service.service.js';

@Controller()
export class InventoryServiceController {
  constructor(
    private readonly inventoryServiceService: InventoryServiceService,
  ) {}

  @Get()
  getHello(): string {
    return this.inventoryServiceService.getHello();
  }
}
