import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CommonModule } from '../common/common.module';
import { SignalingModule } from '../signaling/signaling.module';
import { CallBlockerService } from './call-blocker.service';
import { CallBlockerController } from './call-blocker.controller';

@Module({
  imports: [CommonModule, SignalingModule, HttpModule],
  providers: [CallBlockerService],
  controllers: [CallBlockerController],
})
export class CallBlockerModule {}
