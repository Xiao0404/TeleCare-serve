import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateRemoteConfigDto {
  @IsOptional()
  @IsString()
  elderId?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  volume!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ringVolume?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  notificationVolume?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  alarmVolume?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  brightness!: number;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medicineReminderTimes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedApps?: string[];
}
