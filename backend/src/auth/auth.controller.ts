import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

const COOKIE_NAME = 'session';
export const LOGIN_ATTEMPTS_PER_MINUTE = 10;
const isProd = process.env.NODE_ENV === 'production';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // The one endpoint that takes a password guess: limited per client IP
  // (see main.ts's `trust proxy` for how that IP is found behind Caddy
  // and Cloudflare). Answers 429 once the limit is hit.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: LOGIN_ATTEMPTS_PER_MINUTE, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.authService.validateAndIssueToken(
      dto.username,
      dto.password,
    );

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      // Explicit, not just the default: with no `path` set, browsers derive
      // one from the *request* URI (RFC 6265's default-path algorithm) —
      // for a login request at, say, /vinyl-collection/api/auth/login,
      // that would scope the cookie to /vinyl-collection/api/auth and it
      // would silently stop being sent on every other API call once the
      // app is served under a subpath. '/' keeps it valid for the whole
      // origin regardless of what prefix the app is deployed under.
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days — keep roughly in sync with JWT_EXPIRES_IN
    });

    return { status: 'ok' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    // Must match the path the cookie was set with, or the browser won't
    // recognize it as the same cookie to clear.
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { status: 'ok' };
  }

  // Lets the Angular admin area check "am I still logged in?" on load.
  @Get('me')
  me(@Req() req: Request) {
    return { user: (req as Request & { user?: unknown }).user };
  }
}
