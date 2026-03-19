import { IsOptional, IsString } from 'class-validator';

export class UnbindFamilyDto {
  @IsOptional()
  @IsString()
  elderId?: string;

  @IsOptional()
  @IsString()
  guardianId?: string;
}
