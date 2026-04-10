import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateRemoteConfigDto {
  @IsOptional()
  @IsString()
  elderId?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  volume!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  brightness!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medicineReminderTimes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedApps?: string[];
}
