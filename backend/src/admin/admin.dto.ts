import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AdminRole, KycSection, KycStatus } from '@prisma/client';

export class AdminLoginDto {
  @IsEmail() email: string;
  @IsString() @Length(1, 200) password: string;
}

export class ListApplicationsQuery {
  @IsOptional() @IsEnum(KycStatus) status?: KycStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(100) pageSize?: number;
}

export class ReviewDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED', 'REUPLOAD_REQUIRED'])
  status: 'VERIFIED' | 'REJECTED' | 'REUPLOAD_REQUIRED';

  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export const VERIFICATION_SECTIONS = ['aadhaar', 'pan', 'bank', 'aadhaarAddress', 'currentAddress'] as const;
export type VerificationSection = (typeof VERIFICATION_SECTIONS)[number];

export class SetVerificationDto {
  /** Allowed values depend on the section; validated in the service. */
  @IsString() status: string;
  /** Mandatory for manual verification and for rejections: documents the review. */
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class FeedbackItemDto {
  @IsEnum(KycSection) section: KycSection;
  @IsString() @MinLength(3) @MaxLength(1000) message: string;
  @IsOptional() @IsString() @MaxLength(40) documentId?: string;
}

export class RequestActionDto {
  @ValidateNested({ each: true })
  @Type(() => FeedbackItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  items: FeedbackItemDto[];

  /** Ask the technician for additional address proof (e.g. when addresses differ). */
  @IsOptional() @IsBoolean() requestAddressProof?: boolean;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class OptionalNoteDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RevealDto {
  @IsIn(['pan', 'bankAccount']) field: 'pan' | 'bankAccount';
  @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

export class CreateStaffDto {
  @IsEmail() email: string;
  @IsString() @Length(2, 120) name: string;
  @IsEnum(AdminRole) role: AdminRole;
  @IsString() @MinLength(10) @MaxLength(200) password: string;
}

export class UpdateStaffDto {
  @IsOptional() @IsEnum(AdminRole) role?: AdminRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
