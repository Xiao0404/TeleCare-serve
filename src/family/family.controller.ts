import { Controller, Get, UseGuards, Request, Post, Body, Query } from '@nestjs/common';
import { FamilyService } from './family.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UnbindFamilyDto } from './dto/unbind-family.dto';
import { GetRemoteConfigDto } from './dto/get-remote-config.dto';
import { UpdateRemoteConfigDto } from './dto/update-remote-config.dto';

@Controller('family')
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  async getDashboard(@Request() req) {
    return this.familyService.getDashboard(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('members')
  async getMembers(@Request() req) {
    return this.familyService.getFamilyMembers(req.user.userId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Post('unbind')
  async unbind(@Request() req, @Body() unbindFamilyDto: UnbindFamilyDto) {
    return this.familyService.unbind(req.user, unbindFamilyDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('remote-config')
  async getRemoteConfig(@Request() req, @Query() query: GetRemoteConfigDto) {
    return this.familyService.getRemoteConfig(req.user, query);
  }

  @UseGuards(JwtAuthGuard)
  @Post('remote-config')
  async updateRemoteConfig(@Request() req, @Body() dto: UpdateRemoteConfigDto) {
    return this.familyService.updateRemoteConfig(req.user, dto);
  }
}
