import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { DeviceModule } from './device/device.module';
import { FamilyModule } from './family/family.module';
import { SignalingModule } from './signaling/signaling.module';
import { LocationModule } from './location/location.module';

@Module({
  imports: [CommonModule, UserModule, AuthModule, DeviceModule, FamilyModule, SignalingModule, LocationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
