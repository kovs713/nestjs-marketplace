export type ReservationStatus = 'active' | 'committed' | 'released' | 'expired';

export interface ReservationItem {
  orderItemId: string;
  productId: string;
  quantity: number;
}

export interface ReservationState extends ReservationItem {
  id: string;
  orderId: string;
  status: ReservationStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ReservationOperation = 'reserve' | 'commit' | 'release';

export interface FinalizeRequest {
  idempotencyKey: string;
  orderId: string;
  /** empty means finalize all holds for the order. */
  items: ReservationItem[];
}

export type ReserveRequest = FinalizeRequest & { expiresAt?: Date };

export interface ReservationResult {
  reservations: ReservationState[];
  /** existing result reused, or finalization made no new transition. */
  replayed: boolean;
}
