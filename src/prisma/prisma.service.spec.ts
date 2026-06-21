import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

const mockConfig = {
  getOrThrow: () => 'postgresql://user:pass@localhost:5432/test',
} as unknown as ConfigService;

describe('PrismaService', () => {
  it('has PrismaClient methods ($connect, $disconnect, $transaction)', () => {
    const service = new PrismaService(mockConfig);
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
    expect(typeof service.$transaction).toBe('function');
  });

  it('has onModuleInit method', () => {
    const service = new PrismaService(mockConfig);
    expect(typeof service.onModuleInit).toBe('function');
  });

  it('has onModuleDestroy method', () => {
    const service = new PrismaService(mockConfig);
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
