import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { validateConfig } from '@app/common';

export type GrpcClientsConfig = {
  users: string;
  catalog: string;
  inventory: string;
  orders: string;
};

const hostPort = z
  .string()
  .regex(/^[\w.-]+:\d+$/, { message: 'must look like host:port' });

export const grpcClientsEnvSchema = z.object({
  USERS_GRPC_URL: hostPort,
  CATALOG_GRPC_URL: hostPort,
  INVENTORY_GRPC_URL: hostPort,
  ORDERS_GRPC_URL: hostPort,
});

export const GRPC_CLIENTS_CONFIG_KEY = 'grpcClients';

export default registerAs<GrpcClientsConfig>(GRPC_CLIENTS_CONFIG_KEY, () => {
  const env = validateConfig(process.env, grpcClientsEnvSchema);
  return {
    users: env.USERS_GRPC_URL,
    catalog: env.CATALOG_GRPC_URL,
    inventory: env.INVENTORY_GRPC_URL,
    orders: env.ORDERS_GRPC_URL,
  };
});
