import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<{ id?: unknown }>();
      const res = context
        .switchToHttp()
        .getResponse<{ setHeader?: (k: string, v: string) => void }>();
      if (typeof req?.id === 'string') res.setHeader?.('x-request-id', req.id);
    }
    return next.handle();
  }
}
