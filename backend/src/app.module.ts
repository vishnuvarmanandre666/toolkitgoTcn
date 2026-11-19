import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import Redis from 'ioredis';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './common/crypto/crypto.service';
import { AppConfigModule } from './config/config.module';
import { DocumentsModule } from './documents/documents.module';
import { KycModule } from './kyc/kyc.module';
import { OtpModule } from './otp/otp.module';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { REDIS, RedisModule } from './redis/redis.module';

@Controller('health')
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async health() {
    const [db, cache] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
    return { status: db.status === 'fulfilled' && cache.status === 'fulfilled' ? 'ok' : 'degraded', db: db.status, redis: cache.status };
  }
}

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    AuditModule,
    AuthModule,
    OtpModule,
    KycModule,
    DocumentsModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
