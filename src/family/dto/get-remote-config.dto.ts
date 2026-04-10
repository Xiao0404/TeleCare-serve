import { IsOptional, IsString } from 'class-validator';

export class GetRemoteConfigDto {
  @IsOptional()
  @IsString()
  elderId?: string;
}
