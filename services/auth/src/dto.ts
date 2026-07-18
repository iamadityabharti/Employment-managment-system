import { ArrayNotEmpty, ArrayUnique, IsArray, IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { ROLES, type Role } from '@atlas/contracts';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}

export class LogoutDto extends RefreshTokenDto {}

export class ProvisionUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(ROLES, { each: true })
  roles!: Role[];
}
