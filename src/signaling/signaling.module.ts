import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SignalingController } from './signaling.controller';
import { SignalingGateway } from './signaling.gateway';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'telecare_secret_key',
    }),
  ],
  controllers: [SignalingController],
  providers: [SignalingGateway],
  exports: [SignalingGateway],
})
export class SignalingModule {}
