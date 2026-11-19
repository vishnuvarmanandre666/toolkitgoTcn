import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { ConsoleSmsProvider, Msg91SmsProvider, SMS_PROVIDER } from './sms/sms.provider';

@Module({
  controllers: [OtpController],
  providers: [
    OtpService,
    Msg91SmsProvider,
    ConsoleSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [APP_CONFIG, Msg91SmsProvider, ConsoleSmsProvider],
      useFactory: (config: AppConfig, msg91: Msg91SmsProvider, consoleSms: ConsoleSmsProvider) =>
        config.sms.driver === 'console' ? consoleSms : msg91,
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
