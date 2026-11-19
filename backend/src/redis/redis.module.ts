import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export const REDIS = Symbol('REDIS');

/** Owns the Redis connection lifecycle: reconnection with backoff and graceful shutdown. */
@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: true,
          // Exponential backoff capped at 5s; never give up reconnecting.
          retryStrategy: (times) => Math.min(times * 200, 5000),
          reconnectOnError: (err) => err.message.includes('READONLY'),
        });
        client.on('connect', () => logger.log('connected'));
        client.on('reconnecting', (ms: number) => logger.warn(`reconnecting in ${ms}ms`));
        client.on('error', (err) => logger.error(`redis error: ${err.message}`));
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
export class RedisModule {}
