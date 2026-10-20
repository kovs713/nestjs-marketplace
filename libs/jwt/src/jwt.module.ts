import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { TOKEN_CONFIG_KEY, type JwtConfig } from './jwt.config.js';
import { AppJwtService } from './jwt.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.getOrThrow<JwtConfig>(TOKEN_CONFIG_KEY);
        return { secret: token.secret };
      },
    }),
  ],
  providers: [AppJwtService],
  exports: [AppJwtService],
})
export class AppJwtModule {}
