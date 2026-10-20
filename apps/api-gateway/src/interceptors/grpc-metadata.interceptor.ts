import {
  InterceptingCall,
  RequesterBuilder,
  type Interceptor,
} from '@grpc/grpc-js';

import { requestContext } from '../request-context.js';

/** Forwards x-user-id from request context to outgoing gRPC calls */
export const grpcMetadataInterceptor: Interceptor = (options, nextCall) =>
  new InterceptingCall(
    nextCall(options),
    new RequesterBuilder()
      .withStart((metadata, listener, next) => {
        const sub = requestContext.getStore()?.request.user?.sub;

        if (sub) {
          metadata.set('x-user-id', sub);
        }
        next(metadata, listener);
      })
      .build(),
  );
