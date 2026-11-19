import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Gender } from '@prisma/client';

const NAME_REGEX = /^[A-Za-z][A-Za-z .'-]{1,148}$/;
const NAME_MSG = 'Name may contain letters, spaces, dots, apostrophes and hyphens only';

export class PersonalInfoDto {
  @IsString()
  @Matches(NAME_REGEX, { message: NAME_MSG })
  fullName: string;

  @IsDateString({ strict: true }, { message: 'Date of birth must be YYYY-MM-DD' })
  dateOfBirth: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(190)
  email?: string | null;

  @IsString()
  @Matches(/^(\+?91)?[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian mobile number' })
  emergencyContact: string;
}

export class AadhaarDto {
  @IsString()
  @Matches(/^[2-9]\d{3}\s?\d{4}\s?\d{4}$/, { message: 'Aadhaar number must be 12 digits' })
  aadhaarNumber: string;

  @IsString()
  @Matches(NAME_REGEX, { message: NAME_MSG })
  nameOnAadhaar: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dobOnAadhaar?: string;

  /** Explicit, informed consent is mandatory before any Aadhaar processing. */
  @Equals(true, { message: 'Consent is required to process Aadhaar details' })
  consent: boolean;
}

export class PanDto {
  @IsString()
  @Matches(/^[A-Za-z]{5}\d{4}[A-Za-z]$/, { message: 'PAN must be in the format ABCDE1234F' })
  pan: string;

  @IsString()
  @Matches(NAME_REGEX, { message: NAME_MSG })
  holderName: string;
}

export class AddressFieldsDto {
  @IsOptional() @IsString() @MaxLength(100) houseNumber?: string;
  @IsOptional() @IsString() @MaxLength(150) buildingName?: string;
  @IsOptional() @IsString() @MaxLength(150) street?: string;
  @IsOptional() @IsString() @MaxLength(150) locality?: string;
  @IsString() @Length(2, 100) villageCity: string;
  @IsOptional() @IsString() @MaxLength(100) mandalTaluka?: string;
  @IsString() @Length(2, 100) district: string;
  @IsString() @Length(2, 60) state: string;
  @Matches(/^[1-9]\d{5}$/, { message: 'PIN code must be 6 digits' }) pinCode: string;
  @IsOptional() @IsString() @MaxLength(60) country?: string;
}

export class CurrentAddressFieldsDto extends AddressFieldsDto {
  @IsOptional() @IsString() @MaxLength(150) landmark?: string;
}

export class AddressesDto {
  /** Omit when the Aadhaar address was populated by a verification provider (locked). */
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressFieldsDto)
  aadhaarAddress?: AddressFieldsDto;

  @IsBoolean()
  addressesSame: boolean;

  /** Required when addressesSame is false. When true, only `landmark` is used. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CurrentAddressFieldsDto)
  currentAddress?: CurrentAddressFieldsDto;

  @IsOptional() @IsString() @MaxLength(150) landmark?: string;
}

export class BankDto {
  @IsString()
  @Matches(NAME_REGEX, { message: NAME_MSG })
  accountHolderName: string;

  @Matches(/^\d{9,18}$/, { message: 'Account number must be 9 to 18 digits' })
  accountNumber: string;

  @IsString()
  confirmAccountNumber: string;

  @Matches(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, { message: 'IFSC must be 11 characters, e.g. SBIN0001234' })
  ifsc: string;

  @IsString() @Length(2, 120) bankName: string;
  @IsOptional() @IsString() @MaxLength(120) branchName?: string;
}
