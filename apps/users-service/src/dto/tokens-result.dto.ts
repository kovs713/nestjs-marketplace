export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface IssuedTokens extends TokenPair {
  refreshExpiresAt: Date;
}
