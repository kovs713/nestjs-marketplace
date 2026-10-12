export interface StockState {
  productId: string;
  inStock: number;
  inReserved: number;
  revision: number;
  updatedAt: Date;
}
