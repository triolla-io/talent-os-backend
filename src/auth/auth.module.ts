import { Module } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { SessionGuard } from './session.guard';
import { EmailService } from './email.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  // PrismaModule is @Global() — no need to import it here
  controllers: [AuthController],
  providers: [JwtService, SessionGuard, EmailService, AuthService],
  exports: [JwtService, SessionGuard, EmailService],
})
export class AuthModule {}
