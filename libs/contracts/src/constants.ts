import { join } from 'node:path';

export const PROTO_ROOT =
  process.env.PROTO_ROOT ?? join(process.cwd(), 'libs', 'contracts', 'proto');
