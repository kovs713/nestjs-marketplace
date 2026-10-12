import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { ResilienceModule } from '@nestjs/resilience';

import { appConfig, AppLoggerModule, HealthModule } from '@app/common';
import { CATALOG_V1_PACKAGE_NAME } from '@app/contracts/generated/catalog/v1/catalog.js';
import { INVENTORY_V1_PACKAGE_NAME } from '@app/contracts/generated/inventory/v1/inventory.js';
import { ORDERS_V1_PACKAGE_NAME } from '@app/contracts/generated/orders/v1/order.js';
import { USERS_V1_PACKAGE_NAME } from '@app/contracts/generated/users/v1/users.js';
import { AppJwtModule, tokenConfig } from '@app/jwt';

import { grpcClient } from './grpc/grpc-client.util.js';
import grpcClientsConfig, {
  GRPC_CLIENTS_CONFIG_KEY,
  type GrpcClientsConfig,
} from './grpc/grpc-clients.config.js';
import { GrpcResilience } from './grpc/grpc-resilience.js';
import { RolesGuard } from './guards/roles.guard.js';
import { RequestContextMiddleware } from './middlewares/request-context.middleware.js';
import { CatalogClient } from './modules/catalog/catalog.client.js';
import { CATALOG_CLIENT } from './modules/catalog/catalog.token.js';
import { CategoriesController } from './modules/catalog/categories.controller.js';
import { ProductsController } from './modules/catalog/products.controller.js';
import { InventoryClient } from './modules/inventory/inventory.client.js';
import { INVENTORY_CLIENT } from './modules/inventory/inventory.token.js';
import { StockController } from './modules/inventory/stock.controller.js';
import { OrdersClient } from './modules/orders/orders.client.js';
import { OrdersController } from './modules/orders/orders.controller.js';
import { ORDERS_CLIENT } from './modules/orders/orders.token.js';
import { AuthController } from './modules/users/auth.controller.js';
import { UsersClient } from './modules/users/users.client.js';
import { USERS_CLIENT } from './modules/users/users.token.js';

@Module({
  imports: [
    AppLoggerModule.register('api-gateway'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/api-gateway/.env'],
      load: [appConfig, tokenConfig, grpcClientsConfig],
    }),
    HealthModule,
    AppJwtModule,
    ResilienceModule.forRoot(),
    ClientsModule.registerAsync([
      // users-service
      {
        name: USERS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          grpcClient(
            USERS_V1_PACKAGE_NAME,
            'users/v1/users.proto',
            config.getOrThrow<GrpcClientsConfig>(GRPC_CLIENTS_CONFIG_KEY).users,
          ),
      },

      // catalog-service
      {
        name: CATALOG_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          grpcClient(
            CATALOG_V1_PACKAGE_NAME,
            'catalog/v1/catalog.proto',
            config.getOrThrow<GrpcClientsConfig>(GRPC_CLIENTS_CONFIG_KEY)
              .catalog,
          ),
      },

      // inventory-service
      {
        name: INVENTORY_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          grpcClient(
            INVENTORY_V1_PACKAGE_NAME,
            'inventory/v1/inventory.proto',
            config.getOrThrow<GrpcClientsConfig>(GRPC_CLIENTS_CONFIG_KEY)
              .inventory,
          ),
      },

      // orders-service
      {
        name: ORDERS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          grpcClient(
            ORDERS_V1_PACKAGE_NAME,
            'orders/v1/order.proto',
            config.getOrThrow<GrpcClientsConfig>(GRPC_CLIENTS_CONFIG_KEY)
              .orders,
          ),
      },
    ]),
  ],
  controllers: [
    AuthController,
    ProductsController,
    CategoriesController,
    StockController,
    OrdersController,
  ],
  providers: [
    RolesGuard,
    GrpcResilience,

    CatalogClient,
    InventoryClient,
    OrdersClient,
    UsersClient,
  ],
})
export class ApiGatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
