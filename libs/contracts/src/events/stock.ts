import { z } from 'zod';

export const STOCK_INITIALIZED = 'stock.initialized';
export const STOCK_CHANGED = 'stock.changed';

export const stockInitializedSchema = z.strictObject({
  product_id: z.string().min(1),
  in_stock: z.number().int().nonnegative(),
  in_reserved: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const stockChangedSchema = stockInitializedSchema;

export type StockInitialized = z.infer<typeof stockInitializedSchema>;
export type StockChanged = z.infer<typeof stockChangedSchema>;
