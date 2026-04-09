import { Module } from '@nestjs/common';
import { JwtService } from './jwt.service';

@Module({
  providers: [JwtService],
  exports: [JwtService], // exported so Phase 19/21 can inject it
})
export class AuthModule {}
