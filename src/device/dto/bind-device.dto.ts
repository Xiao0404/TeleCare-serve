import { IsString, IsOptional, Length } from 'class-validator';

export class BindDeviceDto {
  @IsString()
  @Length(6, 6)
  code: string;

  @IsString()
  @IsOptional()
  nickname?: string;
}
