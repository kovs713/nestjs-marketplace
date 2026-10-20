import { z } from 'zod';

export const CHECKOUT_REQUESTED = 'checkout.requested';

export const checkoutRequestedSchema = z.strictObject({
  order_id: z.uuid(),
});
