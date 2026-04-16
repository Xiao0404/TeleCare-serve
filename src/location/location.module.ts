import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { SignalingModule } from '../signaling/signaling.module';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';

@Module({
  imports: [CommonModule, SignalingModule],
  controllers: [LocationController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
