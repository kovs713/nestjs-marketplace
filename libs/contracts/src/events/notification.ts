import { z } from 'zod';

export const NOTIFICATION_REQUESTED = 'notification.requested';

export const notificationRequestedSchema = z.strictObject({
  user_id: z.uuid(),
  order_id: z.uuid().optional(),
  type: z.enum(['ORDER_STATUS', 'PAYMENT', 'STOCK']),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type NotificationRequested = z.infer<typeof notificationRequestedSchema>;
