import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class TriggerPayRunDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}

export class PayRunQueryDto {
  @IsUUID()
  @IsOptional()
  employeeId?: string;
}
