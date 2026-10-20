export type ProductState = {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  priceMinor: number;
  imageUrl: string | null;
  categoryIds: string[];
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type ProductUpdate = {
  title?: string;
  description?: string;
  priceMinor?: number;
  imageUrl?: string | null;
  categoryIds?: string[];
};
