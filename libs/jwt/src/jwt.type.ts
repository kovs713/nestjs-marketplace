import { Request as ExpressRequest } from 'express';

export type AccessClaims = {
  sub: string;
  login: string;
  role: string;
};

export type RefreshClaims = {
  sub: string;
  jti: string;
};

export type Request = ExpressRequest & { user?: AccessClaims };
export type RequestWithUser = ExpressRequest & { user: AccessClaims };
