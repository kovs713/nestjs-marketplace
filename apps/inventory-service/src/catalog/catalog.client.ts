import { status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';

import { DomainError } from '@app/common';
import {
  CATALOG_SERVICE_NAME,
  type CatalogServiceClient,
} from '@app/contracts/generated/catalog/v1/catalog.js';

import { CATALOG_CLIENT } from './catalog.config.js';

@Injectable()
export class CatalogClient implements OnModuleInit {
  private catalog!: CatalogServiceClient;

  constructor(@Inject(CATALOG_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.catalog =
      this.client.getService<CatalogServiceClient>(CATALOG_SERVICE_NAME);
  }

  async sellerId(productId: string): Promise<string> {
    try {
      const product = await firstValueFrom(
        this.catalog.getProduct({ id: productId }).pipe(timeout(3_000)),
      );

      return product.sellerId;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === status.NOT_FOUND) {
          throw new DomainError('NOT_FOUND', 'product not found');
        }

        if (error.code === status.INVALID_ARGUMENT) {
          throw new DomainError('INVALID_ARGUMENT', 'invalid product id');
        }
      }

      throw new DomainError('UNAVAILABLE', 'catalog lookup unavailable');
    }
  }
}
