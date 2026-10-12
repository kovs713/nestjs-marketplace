import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '@app/jwt';

import { Roles } from '../../decorators/roles.decorator.js';
import { RolesGuard } from '../../guards/roles.guard.js';
import {
  type AdjustStockDto,
  adjustStockSchema,
} from './dto/adjust-stock.schema.js';
import { type StockListDto, stockListSchema } from './dto/stock-list.schema.js';
import { type SetStockDto, setStockSchema } from './dto/stock.schema.js';
import { InventoryClient } from './inventory.client.js';

@Controller()
export class StockController {
  constructor(private readonly client: InventoryClient) {}

  @Get('stocks')
  async list(@Query({ schema: stockListSchema }) query: StockListDto) {
    return this.client.listStocks({
      page: { limit: query.limit ?? 0, cursor: query.cursor ?? '' },
      productIds: query.productIds ?? [],
    });
  }

  @Get('products/:productId/stock')
  async get(@Param('productId') productId: string) {
    return this.client.getStock({ productId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Post('products/:productId/stock')
  async set(
    @Param('productId') productId: string,
    @Body({ schema: setStockSchema }) dto: SetStockDto,
  ) {
    return this.client.setStock({ productId, inStock: dto.inStock });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Patch('products/:productId/stock')
  async adjust(
    @Param('productId') productId: string,
    @Body({ schema: adjustStockSchema }) dto: AdjustStockDto,
  ) {
    return this.client.adjustStock({ productId, delta: dto.delta });
  }
}
