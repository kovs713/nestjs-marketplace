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

import { Roles } from '../../decorators/roles.decorator.js';
import { RolesGuard } from '../../guards/roles.guard.js';
import { CatalogClient } from './catalog.client.js';
import {
  createProductSchema,
  type CreateProductDto,
} from './dto/create-product.schema.js';
import {
  productListSchema,
  type ProductsListDto,
} from './dto/product-list.schema.js';
import { searchSchema, type SearchDto } from './dto/search.schema.js';
import {
  updateProductSchema,
  type UpdateProductDto,
} from './dto/update-product.schema.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly client: CatalogClient) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Post()
  async create(
    @Body({ schema: createProductSchema }) dto: CreateProductDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.client.createProduct({
      title: dto.title,
      description: dto.description,
      priceMinor: dto.priceMinor,
      imageUrl: dto.imageUrl ?? '',
      categoryIds: dto.categoryIds,
      initialStock: dto.initialStock,
      idempotencyKey: idempotencyKey ?? '',
    });
  }

  @Get()
  list(@Query({ schema: productListSchema }) query: ProductsListDto) {
    return this.client.getListProducts({
      page: { limit: query.limit ?? 0, cursor: query.cursor ?? '' },
      sellerId: query.sellerId ?? '',
      categoryId: query.categoryId ?? '',
    });
  }

  @Get('search')
  search(@Query({ schema: searchSchema }) query: SearchDto) {
    return this.client.search({
      query: query.q,
      categoryId: query.categoryId ?? '',
      page: { limit: query.limit ?? 0, cursor: query.cursor ?? '' },
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get(':id/own')
  getOwn(@Param('id') id: string) {
    return this.client.getOwnProduct({ id });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.client.getProduct({ id });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body({ schema: updateProductSchema }) dto: UpdateProductDto,
  ) {
    return this.client.updateProduct({
      id,
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && {
        description: dto.description,
      }),
      ...(dto.priceMinor !== undefined && { priceMinor: dto.priceMinor }),
      ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      categoryIds: dto.categoryIds ?? [],
      replaceCategoryIds: dto.categoryIds !== undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.client.deleteProduct({ id });
  }
}
