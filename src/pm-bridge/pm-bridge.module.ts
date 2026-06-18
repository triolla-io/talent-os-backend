import { Module } from '@nestjs/common';
import { PmBridgeController } from './pm-bridge.controller';
import { PmBridgeService } from './pm-bridge.service';
import { PmBridgeGuard } from './pm-bridge.guard';
import { JiraGatewayService } from './jira-gateway.service';
import { PmAiService } from './pm-ai.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PmBridgeController],
  providers: [PmBridgeService, PmBridgeGuard, JiraGatewayService, PmAiService],
})
export class PmBridgeModule {}
