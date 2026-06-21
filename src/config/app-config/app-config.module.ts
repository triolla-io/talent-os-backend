import { Module } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AppConfigController],
  // AppConfigService is consumed only by AppConfigController (same module), so it is not exported.
  providers: [AppConfigService],
})
export class AppConfigModule {}
