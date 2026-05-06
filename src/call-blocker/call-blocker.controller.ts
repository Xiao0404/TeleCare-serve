import { Controller, Get, Post, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallBlockerService } from './call-blocker.service';
import { UpsertBlacklistDto } from './dto/upsert-blacklist.dto';

@Controller('call-blocker')
export class CallBlockerController {
  constructor(private readonly service: CallBlockerService) {}

  @UseGuards(JwtAuthGuard)
  @Get('blacklist')
  async getBlacklist(@Request() req) {
    return this.service.getBlacklist(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('blacklist')
  async upsertBlacklist(@Request() req, @Body() dto: UpsertBlacklistDto) {
    return this.service.upsertBlacklist(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('blacklist/:phoneNumber')
  async removeNumber(@Request() req, @Param('phoneNumber') phoneNumber: string) {
    return this.service.removeNumber(req.user.userId, phoneNumber);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync-public')
  async syncPublicList(@Request() req) {
    return this.service.syncPublicList(req.user.userId);
  }
}
