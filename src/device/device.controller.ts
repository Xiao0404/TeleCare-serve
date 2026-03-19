import { Controller, Post, UseGuards, Request, ForbiddenException, Body } from '@nestjs/common';
import { DeviceService } from './device.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '@prisma/client';
import { BindDeviceDto } from './dto/bind-device.dto';

@Controller('bind')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @UseGuards(JwtAuthGuard)
  @Post('generate')
  async generatePairCode(@Request() req) {
    const user = req.user;
    
    // 只有老人端可以生成配对码
    if (user.role !== UserRole.ELDER) {
        throw new ForbiddenException('只有老人端设备可以生成配对码');
    }

    return this.deviceService.generatePairCode(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify')
  async verifyPairCode(@Request() req, @Body() bindDeviceDto: BindDeviceDto) {
      const user = req.user;
      
      // 只有守护端可以扫码绑定
      if (user.role !== UserRole.GUARDIAN) {
          throw new ForbiddenException('只有守护端可以绑定老人设备');
      }

      return this.deviceService.bindDevice(user.userId, bindDeviceDto.code, bindDeviceDto.nickname);
  }
}
