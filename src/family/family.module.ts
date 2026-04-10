import { Module } from '@nestjs/common';
import { FamilyService } from './family.service';
import { FamilyController } from './family.controller';
import { CommonModule } from '../common/common.module';
import { SignalingModule } from '../signaling/signaling.module';

@Module({
  imports: [CommonModule, SignalingModule],
  providers: [FamilyService],
  controllers: [FamilyController],
})
export class FamilyModule {}
