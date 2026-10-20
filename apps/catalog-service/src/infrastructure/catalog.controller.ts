import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';

import {
  CurrentActor,
  GrpcExceptionFilter,
  validateUuid,
  type Actor,
} from '@app/common';
import {
  CATALOG_SERVICE_NAME,
  type Category,
  type CategoryList,
  type CreateProductRequest,
  type DeleteProductRequest,
  type GetCategoryRequest,
  type GetProductRequest,
  type ListCategoriesRequest,
  type ListProductsRequest,
  type Product,
  type ProductList,
  type SearchRequest,
  type UpdateProductRequest,
} from '@app/contracts/generated/catalog/v1/catalog.js';

import { CatalogCommands } from '../application/catalog.commands.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import {
  toProductUpdate,
  toProtoCategory,
  toProtoProduct,
} from './catalog.mapper.js';

@Controller()
@UseFilters(GrpcExceptionFilter)
export class CatalogController {
  constructor(
    private readonly commands: CatalogCommands,
    private readonly queries: CatalogQueries,
  ) {}

  // Commands

  @GrpcMethod(CATALOG_SERVICE_NAME, 'CreateProduct')
  async createProduct(
    @Payload() req: CreateProductRequest,
    @CurrentActor() seller: Actor,
  ): Promise<Product> {
    req.categoryIds?.forEach((id) => validateUuid<string>(id));

    const view = await this.commands.createProduct(seller, req);

    return toProtoProduct(view);
  }

  @GrpcMethod(CATALOG_SERVICE_NAME, 'UpdateProduct')
  async updateProduct(
    @Payload() req: UpdateProductRequest,
    @CurrentActor() seller: Actor,
  ): Promise<Product> {
    const productId = validateUuid<string>(req.id);

    req.categoryIds?.forEach((id) => validateUuid<string>(id));

    const state = await this.commands.updateProduct(
      seller,
      productId,
      toProductUpdate(req),
    );

    await this.queries.invalidateProduct(state.id);
    const current = await this.queries.getProduct(state.id, true);

    return toProtoProduct({ ...state, stock: current.stock });
  }

  @GrpcMethod(CATALOG_SERVICE_NAME, 'DeleteProduct')
  async deleteProduct(
    @Payload() req: DeleteProductRequest,
    @CurrentActor() seller: Actor,
  ): Promise<Product> {
    const state = await this.commands.deleteProduct(
      seller,
      validateUuid<string>(req.id),
    );

    await this.queries.invalidateProduct(state.id);
    const current = await this.queries.getProduct(state.id, true);

    return toProtoProduct({ ...state, stock: current.stock });
  }

  // Queries

  @GrpcMethod(CATALOG_SERVICE_NAME, 'GetProduct')
  async getProduct(req: GetProductRequest): Promise<Product> {
    const productId = validateUuid<string>(req.id);

    const product = await this.queries.getProduct(productId);

    return toProtoProduct(product);
  }

  @GrpcMethod(CATALOG_SERVICE_NAME, 'GetOwnProduct')
  async getOwnProduct(
    @Payload() req: GetProductRequest,
    @CurrentActor() seller: Actor,
  ): Promise<Product> {
    const productId = validateUuid<string>(req.id);

    const product = await this.queries.getOwnProduct(seller.id, productId);

    return toProtoProduct(product);
  }

  @GrpcMethod(CATALOG_SERVICE_NAME, 'ListProducts')
  async listProducts(req: ListProductsRequest): Promise<ProductList> {
    if (req.sellerId) {
      validateUuid<string>(req.sellerId);
    }
    if (req.categoryId) {
      validateUuid<string>(req.categoryId);
    }

    const page = await this.queries.listProducts({
      page: req.page,
      sellerId: req.sellerId,
      categoryId: req.categoryId,
    });

    return {
      items: page.items.map((productView) => toProtoProduct(productView)),
      nextCursor: page.nextCursor,
    };
  }

  @GrpcMethod(CATALOG_SERVICE_NAME, 'Search')
  async search(req: SearchRequest): Promise<ProductList> {
    if (req.categoryId) {
      validateUuid<string>(req.categoryId);
    }

    const page = await this.queries.search(req.query, req.categoryId, req.page);

    return {
      items: page.items.map((productView) => toProtoProduct(productView)),
      nextCursor: page.nextCursor,
    };
  }

  @GrpcMethod(CATALOG_SERVICE_NAME, 'GetCategory')
  async getCategory(req: GetCategoryRequest): Promise<Category> {
    const categoryId = validateUuid<string>(req.id);

    const category = await this.queries.getCategory(categoryId);

    return toProtoCategory(category);
  }

  @GrpcMethod(CATALOG_SERVICE_NAME, 'ListCategories')
  async listCategories(req: ListCategoriesRequest): Promise<CategoryList> {
    if (req.parentId) {
      validateUuid<string>(req.parentId);
    }

    const page = await this.queries.listCategories(req);

    return {
      items: page.items.map(toProtoCategory),
      nextCursor: page.nextCursor,
    };
  }
}
