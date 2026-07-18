import { Module } from '@nestjs/common';
import { CoreModule, DatabaseModule, RabbitMqModule } from '@atlas/platform';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthSchemaBootstrap } from './auth.schema';
import { AuthService } from './auth.service';
import { LoginRateLimiter } from './login-rate-limiter';

@Module({
  imports: [CoreModule, DatabaseModule, RabbitMqModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, AuthSchemaBootstrap, LoginRateLimiter]
})
export class AuthModule {}
