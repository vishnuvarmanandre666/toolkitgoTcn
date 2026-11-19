import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { DIGILOCKER_CLIENT, LiveDigilockerClient } from './digilocker/digilocker.client';
import { DigilockerCallbackController, DigilockerStartController } from './digilocker/digilocker.controller';
import { MockDigilockerClient } from './digilocker/digilocker-mock.client';
import { DigilockerService } from './digilocker/digilocker.service';
import { TechnicianKycController } from './kyc.controller';
import { KycService } from './kyc.service';
import {
  AADHAAR_PROVIDER,
  ManualAadhaarProvider,
  ManualPanProvider,
  MockAadhaarProvider,
  MockPanProvider,
  PAN_PROVIDER,
} from './providers/identity-providers';

/**
 * Provider selection. To integrate a licensed vendor, implement
 * AadhaarVerificationProvider / PanVerificationProvider and add a case here.
 */
@Module({
  controllers: [TechnicianKycController, DigilockerStartController, DigilockerCallbackController],
  providers: [
    KycService,
    DigilockerService,
    ManualAadhaarProvider,
    ManualPanProvider,
    MockAadhaarProvider,
    MockPanProvider,
    {
      provide: DIGILOCKER_CLIENT,
      inject: [APP_CONFIG, PrismaService],
      useFactory: (c: AppConfig, prisma: PrismaService) =>
        c.digilocker.mode === 'live' ? new LiveDigilockerClient(c.digilocker) : c.digilocker.mode === 'mock' ? new MockDigilockerClient(prisma) : null,
    },
    {
      provide: AADHAAR_PROVIDER,
      inject: [APP_CONFIG, ManualAadhaarProvider, MockAadhaarProvider],
      useFactory: (c: AppConfig, manual: ManualAadhaarProvider, mock: MockAadhaarProvider) => {
        switch (c.providers.aadhaar) {
          case 'mock':
            return mock;
          case 'manual':
            return manual;
          default:
            throw new Error(`Unknown AADHAAR_PROVIDER "${c.providers.aadhaar}"`);
        }
      },
    },
    {
      provide: PAN_PROVIDER,
      inject: [APP_CONFIG, ManualPanProvider, MockPanProvider],
      useFactory: (c: AppConfig, manual: ManualPanProvider, mock: MockPanProvider) => {
        switch (c.providers.pan) {
          case 'mock':
            return mock;
          case 'manual':
            return manual;
          default:
            throw new Error(`Unknown PAN_PROVIDER "${c.providers.pan}"`);
        }
      },
    },
  ],
  exports: [KycService],
})
export class KycModule {}
