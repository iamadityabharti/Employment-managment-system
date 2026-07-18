import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  SetMetadata,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import type { JwtClaims, Role } from '@atlas/contracts';

export interface AuthenticatedRequest extends Request {
  user?: JwtClaims;
}

export const ROLES_METADATA_KEY = 'atlas:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_METADATA_KEY, roles);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('A bearer access token is required');
    }
    try {
      request.user = jwt.verify(header.slice('Bearer '.length), requiredJwtSecret()) as JwtClaims;
      return true;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_METADATA_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.roles.some((role) => required.includes(role))) {
      throw new ForbiddenException('Your role cannot perform this action');
    }
    return true;
  }
}

export function requiredJwtSecret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value) {
    throw new Error('JWT_ACCESS_SECRET is required');
  }
  return value;
}

/**
 * HTTP 429 — NestJS 11 does not export TooManyRequestsException from
 * @nestjs/common, so we provide a shared subclass for the gateway and auth
 * rate limiters to use.
 */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too Many Requests') {
    super({ statusCode: 429, message, error: 'Too Many Requests' }, 429);
  }
}
