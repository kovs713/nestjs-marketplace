import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '@app/jwt';

import {
  type AddToCartDto,
  addToCartSchema,
} from './dto/add-to-cart.schema.js';
import { type OrderListDto, orderListSchema } from './dto/order-list.schema.js';
import {
  type UpdateCartItemDto,
  updateCartItemSchema,
} from './dto/update-cart-item.schema.js';
import { OrdersClient } from './orders.client.js';

@UseGuards(JwtAuthGuard)
@Controller()
export class OrdersController {
  constructor(private readonly client: OrdersClient) {}

  // cart
  @Post('cart/items')
  async addToCart(@Body({ schema: addToCartSchema }) dto: AddToCartDto) {
    return this.client.addToCart({
      productId: dto.productId,
      quantity: dto.quantity,
    });
  }

  @Get('cart')
  async getCart() {
    return this.client.getCart({});
  }

  @Patch('cart/items/:itemId')
  async updateCartItem(
    @Param('itemId') itemId: string,
    @Body({ schema: updateCartItemSchema }) dto: UpdateCartItemDto,
  ) {
    return this.client.updateCartItem({
      orderItemId: itemId,
      quantity: dto.quantity,
    });
  }

  @Delete('cart/items/:itemId')
  async removeCartItem(@Param('itemId') itemId: string) {
    return this.client.removeCartItem({ orderItemId: itemId });
  }

  // orders
  @Post('orders/checkout')
  async checkout(@Headers('idempotency-key') idempotencyKey: string) {
    return this.client.checkout(
      {
        idempotencyKey: idempotencyKey ?? '',
      },
      Boolean(idempotencyKey),
    );
  }

  @Get('orders')
  async list(@Query({ schema: orderListSchema }) query: OrderListDto) {
    return this.client.list({
      page: { limit: query.limit ?? 0, cursor: query.cursor ?? '' },
      statuses: [],
    });
  }

  @Get('orders/:id')
  async get(@Param('id') id: string) {
    return this.client.get({ id });
  }

  @Post('orders/:id/cancel')
  async cancel(@Param('id') id: string) {
    return this.client.cancel({ id, reason: '' });
  }
}
