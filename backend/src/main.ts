import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // In production every request arrives through Caddy (and cloudflared
  // before it), both on private container addresses. Trusting those hops
  // makes `req.ip` the real client taken from X-Forwarded-For, which the
  // login rate limit keys on; a direct connection is unaffected.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  // Don't advertise the framework.
  app.disable('x-powered-by');

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200',
    credentials: true,
  });

  // Processed vinyl scans are served through UploadsServeController (see
  // uploads-serve.controller.ts), not a blanket static-file middleware —
  // that's what lets a soft-deleted image stop being servable.

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  console.log(`Vinyl archive backend listening on http://localhost:${port}`);
}

bootstrap();
