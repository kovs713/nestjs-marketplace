import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';

import type {
  AdjustStockRequest,
  GetStockRequest,
  InventoryServiceClient,
  ListStocksRequest,
  SetStockRequest,
  StockList,
} from '@app/contracts/generated/inventory/v1/inventory.js';
import { INVENTORY_SERVICE_NAME } from '@app/contracts/generated/inventory/v1/inventory.js';

import { GrpcResilience } from '../../grpc/grpc-resilience.js';
import { INVENTORY_CLIENT } from './inventory.token.js';

@Injectable()
export class InventoryClient implements OnModuleInit {
  private service!: InventoryServiceClient;

  constructor(
    @Inject(INVENTORY_CLIENT)
    private readonly client: ClientGrpc,
    private readonly resilience: GrpcResilience,
  ) {}

  onModuleInit(): void {
    this.service = this.client.getService<InventoryServiceClient>(
      INVENTORY_SERVICE_NAME,
    );
  }

  async listStocks(request: ListStocksRequest): Promise<StockList> {
    return this.resilience.call(() => this.service.listStocks(request), {
      source: 'stock.list',
      retryable: true,
    });
  }

  async getStock(request: GetStockRequest) {
    return this.resilience.call(() => this.service.getStock(request), {
      source: 'stock.get',
      retryable: true,
    });
  }

  async setStock(request: SetStockRequest) {
    return this.resilience.call(() => this.service.setStock(request), {
      source: 'stock.set',
    });
  }

  async adjustStock(request: AdjustStockRequest) {
    return this.resilience.call(() => this.service.adjustStock(request), {
      source: 'stock.adjust',
    });
  }
}
