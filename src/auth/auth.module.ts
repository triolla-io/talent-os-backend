import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from './jwt.service';
import { SessionGuard } from './session.guard';
import { EmailService } from './email.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InvitationService } from './invitation.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  // PrismaModule is @Global() — no need to import it here
  imports: [StorageModule],
  controllers: [AuthController, TeamController],
  providers: [
    JwtService,
    SessionGuard,
    EmailService,
    AuthService,
    InvitationService,
    TeamService,
    // Register SessionGuard globally: every route requires a session unless it opts out
    // with @Public(). useExisting reuses the single SessionGuard instance (also used by
    // explicit @UseGuards). APP_GUARD declared here applies to the whole API app; the
    // worker bootstraps WorkerModule, which does not import AuthModule, so it is unaffected.
    { provide: APP_GUARD, useExisting: SessionGuard },
  ],
  // Only SessionGuard is consumed by importing modules (via @UseGuards). JwtService and
  // EmailService are used only within this module, so they are not exported.
  exports: [SessionGuard],
})
export class AuthModule {}
