import { Module } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { SessionGuard } from './session.guard';
import { EmailService } from './email.service';

@Module({
  providers: [JwtService, SessionGuard, EmailService],
  exports: [JwtService, SessionGuard, EmailService],
})
export class AuthModule {}
