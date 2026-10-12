import { ClientProvider, Transport } from '@nestjs/microservices';
import { join } from 'node:path';

import { PROTO_ROOT } from '@app/contracts';

import { grpcMetadataInterceptor } from '../interceptors/grpc-metadata.interceptor.js';

export const grpcClient = (
  pkg: string,
  proto: string,
  url: string,
): ClientProvider => ({
  transport: Transport.GRPC,
  options: {
    package: pkg,
    protoPath: join(PROTO_ROOT, proto),
    url,
    loader: {
      includeDirs: [PROTO_ROOT],
      longs: Number,
      defaults: true,
    },
    channelOptions: {
      interceptors: [grpcMetadataInterceptor],
    },
  },
});
