import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetLatestLocationDto } from './dto/get-latest-location.dto';
import { GetLocationHistoryDto } from './dto/get-location-history.dto';
import { ReportLocationDto } from './dto/report-location.dto';
import { UpsertGeofenceDto } from './dto/upsert-geofence.dto';
import { LocationService } from './location.service';

@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @UseGuards(JwtAuthGuard)
  @Post('report')
  async report(@Request() req, @Body() dto: ReportLocationDto) {
    return this.locationService.reportLocation(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('latest')
  async latest(@Request() req, @Query() query: GetLatestLocationDto) {
    return this.locationService.getLatestLocation(req.user, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  async history(@Request() req, @Query() query: GetLocationHistoryDto) {
    return this.locationService.getHistory(req.user, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('geofence')
  async geofence(@Request() req, @Query() query: GetLatestLocationDto) {
    return this.locationService.getGeofence(req.user, query);
  }

  @UseGuards(JwtAuthGuard)
  @Post('geofence')
  async upsertGeofence(@Request() req, @Body() dto: UpsertGeofenceDto) {
    return this.locationService.upsertGeofence(req.user, dto);
  }
}
