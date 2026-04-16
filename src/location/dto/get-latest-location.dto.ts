import { IsOptional, IsString } from 'class-validator';

export class GetLatestLocationDto {
  @IsOptional()
  @IsString()
  elderId?: string;
}
