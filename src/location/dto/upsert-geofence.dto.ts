import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertGeofenceDto {
  @IsOptional()
  @IsString()
  elderId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng: number;

  @Type(() => Number)
  @IsNumber()
  @Min(50)
  @Max(100000)
  radiusMeters: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean = true;
}
