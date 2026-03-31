import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  checks: {
    database: 'ok' | 'fail';
    redis: 'ok' | 'fail';
  };
  uptime: number;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    // Inject existing BullMQ queue to access its underlying Redis connection
    @InjectQueue('ingest-email') private readonly queue: Queue,
  ) {}

  async check(): Promise<HealthCheckResult> {
    const [dbOk, redisOk] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    const status = dbOk && redisOk ? 'ok' : 'degraded';

    return {
      status,
      checks: {
        database: dbOk ? 'ok' : 'fail',
        redis: redisOk ? 'ok' : 'fail',
      },
      uptime: Math.floor(process.uptime()),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      // Use the existing BullMQ queue's Redis client — no new connection created
      const client = await this.queue.client;
      await client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
