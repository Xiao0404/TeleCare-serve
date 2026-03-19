import { Controller, Get, UseGuards, Request, Post, Body } from '@nestjs/common';
import { FamilyService } from './family.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UnbindFamilyDto } from './dto/unbind-family.dto';

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
}
