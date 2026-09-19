import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async validateAndIssueToken(username: string, password: string) {
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (!adminUsername || !adminPasswordHash) {
      throw new UnauthorizedException('Admin credentials are not configured');
    }

    if (username !== adminUsername) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const matches = await bcrypt.compare(password, adminPasswordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return this.jwtService.signAsync({ sub: adminUsername, role: 'admin' });
  }
}
