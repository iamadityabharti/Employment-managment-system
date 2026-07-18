import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '@atlas/platform';
import { JwtAuthGuard, Roles, RolesGuard } from '@atlas/platform';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, ProvisionUserDto, RefreshTokenDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshTokenDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: LogoutDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }

  @Post('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin')
  provision(@Body() body: ProvisionUserDto) {
    return this.auth.provisionUser(body.email, body.password, body.roles);
  }
}
