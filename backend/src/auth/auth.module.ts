import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { requireAuthEnv } from '../config/env';

@Module({
  imports: [
    // Only AuthController's login route opts in (via ThrottlerGuard) —
    // nothing else is rate limited. The default here is never used as is.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    JwtModule.registerAsync({
      useFactory: (): JwtModuleOptions => ({
        // Runs while the app boots, so a missing or placeholder secret (or
        // admin login) stops it there instead of at the first login.
        secret: requireAuthEnv().jwtSecret,
        signOptions: {
          // process.env values are always plain `string`, but @nestjs/jwt's
          // type wants the stricter `ms`-style literal (e.g. "7d" | "1h" | number).
          // This is only ever set via an env var, so we cast it to that type deliberately.
          expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [JwtModule, AuthGuard],
})
export class AuthModule {}
