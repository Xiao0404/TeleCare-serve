import { IsString, IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class LoginDto {
  @IsString()
  phone: string;

  @IsString()
  password: string;

  @IsEnum(UserRole)
  clientRole: UserRole;

  @IsString()
  deviceId: string;
}
