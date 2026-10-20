import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';

import type {
  CatalogServiceClient,
  Category,
  CategoryList,
  CreateProductRequest,
  DeleteProductRequest,
  GetCategoryRequest,
  GetProductRequest,
  ListCategoriesRequest,
  ListProductsRequest,
  Product,
  ProductList,
  SearchRequest,
  UpdateProductRequest,
} from '@app/contracts/generated/catalog/v1/catalog.js';
import { CATALOG_SERVICE_NAME } from '@app/contracts/generated/catalog/v1/catalog.js';

import { GrpcResilience } from '../../grpc/grpc-resilience.js';
import { CATALOG_CLIENT } from './catalog.token.js';

@Injectable()
export class CatalogClient implements OnModuleInit {
  private service!: CatalogServiceClient;

  constructor(
    @Inject(CATALOG_CLIENT)
    private readonly catalogClient: ClientGrpc,
    private readonly resilience: GrpcResilience,
  ) {}

  onModuleInit() {
    this.service =
      this.catalogClient.getService<CatalogServiceClient>(CATALOG_SERVICE_NAME);
  }

  async createProduct(request: CreateProductRequest): Promise<Product> {
    return this.resilience.call(() => this.service.createProduct(request), {
      source: 'products.create',
    });
  }

  async getListProducts(request: ListProductsRequest): Promise<ProductList> {
    return this.resilience.call(() => this.service.listProducts(request), {
      source: 'products.getList',
      retryable: true,
    });
  }

  async getOwnProduct(request: GetProductRequest): Promise<Product> {
    return this.resilience.call(() => this.service.getOwnProduct(request), {
      source: 'products.getOwn',
      retryable: true,
    });
  }

  async getProduct(request: GetProductRequest): Promise<Product> {
    return this.resilience.call(() => this.service.getProduct(request), {
      source: 'products.get',
      retryable: true,
    });
  }

  async updateProduct(request: UpdateProductRequest): Promise<Product> {
    return this.resilience.call(() => this.service.updateProduct(request), {
      source: 'products.update',
    });
  }

  async deleteProduct(request: DeleteProductRequest): Promise<Product> {
    return this.resilience.call(() => this.service.deleteProduct(request), {
      source: 'products.delete',
    });
  }

  async search(request: SearchRequest): Promise<ProductList> {
    return this.resilience.call(() => this.service.search(request), {
      source: 'products.search',
      retryable: true,
    });
  }

  async listCategories(request: ListCategoriesRequest): Promise<CategoryList> {
    return this.resilience.call(() => this.service.listCategories(request), {
      source: 'categories.list',
      retryable: true,
    });
  }

  async getCategory(request: GetCategoryRequest): Promise<Category> {
    return this.resilience.call(() => this.service.getCategory(request), {
      source: 'categories.get',
      retryable: true,
    });
  }
}
