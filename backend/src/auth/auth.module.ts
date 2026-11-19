import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AdminAuthGuard, TechnicianAuthGuard } from './guards';
import { SessionService } from './session.service';
import { SupabaseAuthController } from './supabase-auth.controller';
import { TechnicianLoginService } from './technician-login.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.auth.jwtSecret, signOptions: { issuer: 'toolkitgo' }, verifyOptions: { issuer: 'toolkitgo' } }),
    }),
  ],
  controllers: [SupabaseAuthController],
  providers: [SessionService, TechnicianAuthGuard, AdminAuthGuard, TechnicianLoginService],
  exports: [SessionService, TechnicianAuthGuard, AdminAuthGuard, TechnicianLoginService, JwtModule],
})
export class AuthModule {}
