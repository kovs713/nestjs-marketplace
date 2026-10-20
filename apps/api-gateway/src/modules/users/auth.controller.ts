import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { Role } from '@app/contracts/generated/users/v1/users.js';
import { JwtAuthGuard } from '@app/jwt';

import { loginSchema, type LoginDto } from './dto/login.schema.js';
import { refreshSchema, type RefreshDto } from './dto/refresh.schema.js';
import { registerSchema, type RegisterDto } from './dto/register.schema.js';
import { UsersClient } from './users.client.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly client: UsersClient) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me() {
    return this.client.getMe({});
  }

  @Post('register')
  async register(@Body({ schema: registerSchema }) dto: RegisterDto) {
    return this.client.register({
      login: dto.login,
      email: dto.email,
      password: dto.password,
      role: dto.role === 'seller' ? Role.ROLE_SELLER : Role.ROLE_BUYER,
    });
  }

  @Post('login')
  async login(@Body({ schema: loginSchema }) dto: LoginDto) {
    return this.client.login(dto);
  }

  @Post('refresh')
  async refresh(@Body({ schema: refreshSchema }) dto: RefreshDto) {
    return this.client.refresh(dto);
  }

  @Post('logout')
  async logout(@Body({ schema: refreshSchema }) dto: RefreshDto) {
    await this.client.logout(dto);
  }
}
