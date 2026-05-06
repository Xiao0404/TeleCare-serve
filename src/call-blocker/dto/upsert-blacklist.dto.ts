import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class UpsertBlacklistDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  numbers: string[];
}
