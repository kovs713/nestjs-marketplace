import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { InventoryServiceController } from './inventory-service.controller.js';
import { InventoryServiceService } from './inventory-service.service.js';

describe('InventoryServiceController', () => {
  let inventoryServiceController: InventoryServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [InventoryServiceController],
      providers: [InventoryServiceService],
    }).compile();

    inventoryServiceController = app.get<InventoryServiceController>(
      InventoryServiceController,
    );
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(inventoryServiceController.getHello()).toBe('Hello World!');
    });
  });
});
