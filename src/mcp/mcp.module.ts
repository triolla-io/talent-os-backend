import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { mcpEnvSchema } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CandidatesModule } from '../candidates/candidates.module';
import { JobsModule } from '../jobs/jobs.module';
import { ScoringModule } from '../scoring/scoring.module';
import { McpTokenService } from './mcp-token.service';
import { McpOAuthStore } from './mcp-oauth.store';
import { McpOAuthProvider } from './mcp-oauth.provider';
import { McpOAuthController } from './mcp-oauth.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (config) => mcpEnvSchema.parse(config) }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    PrismaModule,
    AuthModule,
    CandidatesModule,
    JobsModule,
    ScoringModule,
  ],
  controllers: [McpOAuthController],
  providers: [McpTokenService, McpOAuthStore, McpOAuthProvider],
})
export class McpModule {}
