import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';

import { CurrentActor, GrpcExceptionFilter, type Actor } from '@app/common';
import {
  INVENTORY_SERVICE_NAME,
  type AdjustStockRequest,
  type GetStockRequest,
  type ListStocksRequest,
  type SetStockRequest,
  type Stock,
  type StockList,
} from '@app/contracts/generated/inventory/v1/inventory.js';

import { toProtoStock } from './stock.mapper.js';
import { StockService } from './stock.service.js';

@Controller()
@UseFilters(GrpcExceptionFilter)
export class StockController {
  constructor(private readonly inventory: StockService) {}

  // Stock queries

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'GetStock')
  async getStock(req: GetStockRequest): Promise<Stock> {
    return toProtoStock(await this.inventory.getStock(req.productId));
  }

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'ListStocks')
  async listStocks(req: ListStocksRequest): Promise<StockList> {
    const { items, nextCursor } = await this.inventory.listStocks(req);

    return {
      items: items.map(toProtoStock),
      nextCursor,
    };
  }

  // Seller stock administration

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'SetStock')
  async setStock(
    @Payload() req: SetStockRequest,
    @CurrentActor() actor: Actor,
  ): Promise<Stock> {
    return toProtoStock(
      await this.inventory.setStock(req.productId, req.inStock, actor),
    );
  }

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'AdjustStock')
  async adjustStock(
    @Payload() req: AdjustStockRequest,
    @CurrentActor() actor: Actor,
  ): Promise<Stock> {
    return toProtoStock(
      await this.inventory.adjustStock(req.productId, req.delta, actor),
    );
  }
}
