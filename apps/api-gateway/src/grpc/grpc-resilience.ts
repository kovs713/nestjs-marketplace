import { status as grpcStatus } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import {
  isClientError,
  ResilienceService,
  type ResiliencePolicy,
} from '@nestjs/resilience';
import { lastValueFrom, type Observable } from 'rxjs';

const CLIENT_FAULT_CODES = new Set<number>([
  grpcStatus.INVALID_ARGUMENT,
  grpcStatus.NOT_FOUND,
  grpcStatus.ALREADY_EXISTS,
  grpcStatus.PERMISSION_DENIED,
  grpcStatus.UNAUTHENTICATED,
  grpcStatus.FAILED_PRECONDITION,
]);

const RETRYABLE_CODES = new Set<number>([
  grpcStatus.UNAVAILABLE,
  grpcStatus.RESOURCE_EXHAUSTED,
  grpcStatus.DEADLINE_EXCEEDED,
]);

@Injectable()
export class GrpcResilience {
  private readonly logger = new Logger(GrpcResilience.name);

  private readonly readPolicy: ResiliencePolicy;
  private readonly noRetryPolicy: ResiliencePolicy;

  constructor(resilience: ResilienceService) {
    const base: Parameters<ResilienceService['create']>[0] = {
      timeout: '3s',
      circuitBreaker: {
        name: 'grpc-outbound',
        failureRateThreshold: 50,
        slidingWindow: { type: 'count', size: 20 },
        openDuration: '30s',
        recordIf: (err) => this.isCircuitBreakerFailure(err),
      },
    };

    this.noRetryPolicy = resilience.create(
      { ...base, retry: false },
      'grpc-mutations',
    );

    this.readPolicy = resilience.create(
      {
        ...base,
        retry: {
          attempts: 3,
          backoff: { delay: '200ms', factor: 2 },
          retryIf: (err) => {
            const code = this.getGrpcCode(err);
            return code !== undefined && RETRYABLE_CODES.has(code);
          },
        },
      },
      'grpc-outbound',
    );
  }

  call<T>(
    factory: () => Observable<T>,
    options: {
      source?: string;
      retryable?: boolean;
    } = {},
  ): Promise<T> {
    const policy = options.retryable ? this.readPolicy : this.noRetryPolicy;
    const source = options.source ?? 'grpc-outbound';

    return lastValueFrom(policy.executeObservable(factory, { source })).catch(
      (error: unknown) => {
        const log = this.isCircuitBreakerFailure(error)
          ? this.logger.error.bind(this.logger)
          : this.logger.debug.bind(this.logger);

        log({ err: error, msg: 'grpc call failed', source });

        throw error;
      },
    );
  }

  private isCircuitBreakerFailure(err: unknown): boolean {
    const code = this.getGrpcCode(err);
    return (
      code !== undefined && !CLIENT_FAULT_CODES.has(code) && !isClientError(err)
    );
  }

  private getGrpcCode(err: unknown): number | undefined {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      typeof err.code === 'number'
    ) {
      return err.code;
    }

    return undefined;
  }
}
