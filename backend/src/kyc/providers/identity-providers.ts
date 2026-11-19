import { Injectable } from '@nestjs/common';
import { VerificationMethod } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Identity verification provider contracts.
 *
 * COMPLIANCE RULES (enforced by design, keep them when adding vendors):
 * - ToolkitGo never collects, relays or stores Aadhaar OTPs and never calls
 *   UIDAI authentication APIs directly. Aadhaar verification must go through
 *   a legally permitted route: UIDAI Offline e-KYC (paperless XML / Secure QR)
 *   validated by a provider, DigiLocker-consented documents, or another
 *   licensed KUA/verification partner acting under its own authorisation.
 * - A result is VERIFIED only when the provider returns an authoritative
 *   match. Anything else is FAILED, MANUAL_REVIEW or UNAVAILABLE.
 * - Uploaded documents alone never produce VERIFIED; only a documented manual
 *   review by authorised staff can (handled in the admin module).
 */

export type ProviderOutcome = 'VERIFIED' | 'FAILED' | 'MANUAL_REVIEW' | 'UNAVAILABLE' | 'IN_PROGRESS';

export interface AadhaarAddressResult {
  houseNumber?: string;
  buildingName?: string;
  street?: string;
  locality?: string;
  villageCity: string;
  mandalTaluka?: string;
  district: string;
  state: string;
  pinCode: string;
  country?: string;
}

export interface AadhaarVerifyInput {
  technicianId: string;
  aadhaarNumber: string; // used in-memory for this call only
  nameOnAadhaar: string;
  dob?: Date | null;
}

export interface AadhaarVerifyResult {
  outcome: ProviderOutcome;
  method: VerificationMethod;
  providerName: string;
  referenceId?: string;
  /** Data returned by the authoritative source (used for name / DOB matching). */
  name?: string;
  dob?: Date;
  /** Only populated when the provider is permitted to share the address. */
  address?: AadhaarAddressResult;
  reason?: string;
  /** For consent-redirect flows (e.g. DigiLocker): send the technician here; outcome=IN_PROGRESS. */
  redirectUrl?: string;
}

export interface PanVerifyInput {
  technicianId: string;
  pan: string;
  holderName: string;
  dob?: Date | null;
}

export interface PanVerifyResult {
  outcome: ProviderOutcome;
  method: VerificationMethod;
  providerName: string;
  referenceId?: string;
  registeredName?: string;
  panStatus?: string; // e.g. VALID / INVALID / DEACTIVATED as reported by the provider
  reason?: string;
}

export interface AadhaarVerificationProvider {
  readonly name: string;
  verify(input: AadhaarVerifyInput): Promise<AadhaarVerifyResult>;
}
export interface PanVerificationProvider {
  readonly name: string;
  verify(input: PanVerifyInput): Promise<PanVerifyResult>;
}

export const AADHAAR_PROVIDER = Symbol('AADHAAR_PROVIDER');
export const PAN_PROVIDER = Symbol('PAN_PROVIDER');

/** Default: no automatic verification; everything is routed to authorised manual review. */
@Injectable()
export class ManualAadhaarProvider implements AadhaarVerificationProvider {
  readonly name = 'manual';
  async verify(): Promise<AadhaarVerifyResult> {
    return { outcome: 'MANUAL_REVIEW', method: VerificationMethod.MANUAL, providerName: this.name, reason: 'Automatic verification not configured' };
  }
}

@Injectable()
export class ManualPanProvider implements PanVerificationProvider {
  readonly name = 'manual';
  async verify(): Promise<PanVerifyResult> {
    return { outcome: 'MANUAL_REVIEW', method: VerificationMethod.MANUAL, providerName: this.name, reason: 'Automatic verification not configured' };
  }
}

/**
 * Deterministic sandbox for local development & automated tests ONLY (refused
 * in production by config validation). Echoes the submitted data back as the
 * "authoritative" record. Names containing "mismatch" simulate a different
 * registered name; names containing "unavailable" simulate a provider outage.
 */
@Injectable()
export class MockAadhaarProvider implements AadhaarVerificationProvider {
  readonly name = 'mock';
  async verify(input: AadhaarVerifyInput): Promise<AadhaarVerifyResult> {
    const n = input.nameOnAadhaar.toLowerCase();
    if (n.includes('unavailable')) return { outcome: 'UNAVAILABLE', method: VerificationMethod.OFFLINE_EKYC, providerName: this.name, reason: 'Sandbox outage' };
    return {
      outcome: 'VERIFIED',
      method: VerificationMethod.OFFLINE_EKYC,
      providerName: this.name,
      referenceId: `MOCK-AAD-${randomUUID().slice(0, 8)}`,
      name: n.includes('mismatch') ? 'Someone Else Entirely' : input.nameOnAadhaar,
      dob: input.dob ?? undefined,
      address: {
        houseNumber: '12-3-45',
        street: 'Gandhi Road',
        locality: 'Ameerpet',
        villageCity: 'Hyderabad',
        mandalTaluka: 'Khairatabad',
        district: 'Hyderabad',
        state: 'Telangana',
        pinCode: '500016',
        country: 'India',
      },
    };
  }
}

@Injectable()
export class MockPanProvider implements PanVerificationProvider {
  readonly name = 'mock';
  async verify(input: PanVerifyInput): Promise<PanVerifyResult> {
    const n = input.holderName.toLowerCase();
    if (n.includes('unavailable')) return { outcome: 'UNAVAILABLE', method: VerificationMethod.PROVIDER, providerName: this.name, reason: 'Sandbox outage' };
    return {
      outcome: 'VERIFIED',
      method: VerificationMethod.PROVIDER,
      providerName: this.name,
      referenceId: `MOCK-PAN-${randomUUID().slice(0, 8)}`,
      registeredName: n.includes('mismatch') ? 'Someone Else Entirely' : input.holderName,
      panStatus: 'VALID',
    };
  }
}
