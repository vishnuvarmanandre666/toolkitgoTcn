import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { APP_CONFIG, AppConfig } from './config/app-config';

export function configureApp(app: NestExpressApplication) {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useBodyParser('json', { limit: '100kb' });
  app.enableShutdownHooks();
  return config;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = configureApp(app);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`ToolkitGo KYC API listening on :${config.port} (${config.env})`);
}

if (require.main === module) {
  // Load .env for local runs without adding a dependency.
  try {
    process.loadEnvFile?.('.env');
  } catch {
    /* no .env file */
  }
  void bootstrap();
}
