import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { SignalingGateway } from '../signaling/signaling.gateway';
import { GetLatestLocationDto } from './dto/get-latest-location.dto';
import { GetLocationHistoryDto } from './dto/get-location-history.dto';
import { ReportLocationDto } from './dto/report-location.dto';
import { UpsertGeofenceDto } from './dto/upsert-geofence.dto';

type RequestUser = {
  userId: string;
  role: UserRole;
  deviceId?: string;
};

type ResolvedAddress = {
  province: string;
  city: string;
  district: string;
  township: string;
  street: string;
  formattedAddress: string;
  areaText: string;
  shortText: string;
};

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signalingGateway: SignalingGateway,
  ) {}

  private toRadians(value: number) {
    return (value * Math.PI) / 180;
  }

  private calculateDistanceMeters(startLat: number, startLng: number, endLat: number, endLng: number) {
    const earthRadius = 6371000;
    const deltaLat = this.toRadians(endLat - startLat);
    const deltaLng = this.toRadians(endLng - startLng);
    const originLat = this.toRadians(startLat);
    const targetLat = this.toRadians(endLat);

    const haversine =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(originLat) *
        Math.cos(targetLat) *
        Math.sin(deltaLng / 2) *
        Math.sin(deltaLng / 2);

    return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private roundCoordinate(value: number) {
    return Number(value.toFixed(6));
  }

  private normalizeRadius(value: number) {
    return Math.max(50, Math.min(100000, Math.round(value)));
  }

  private uniqueTexts(values: Array<string | null | undefined>) {
    return values
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item, index, list) => Boolean(item) && list.indexOf(item) === index);
  }

  private buildAreaText(province: string, city: string, district: string) {
    return this.uniqueTexts([province, city, district]).join('');
  }

  private buildShortText(district: string, township: string, street: string) {
    return this.uniqueTexts([district, township || street]).join('');
  }

  private isLikelyMainlandChinaCoordinate(lat: number, lng: number) {
    return lat >= 18 && lat <= 54 && lng >= 73 && lng <= 135;
  }

  private buildReverseGeocodeCacheKey(lat: number, lng: number) {
    return `location:regeo:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  }

  private buildCoordinateBucketKey(lat: number, lng: number) {
    return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
  }

  private buildFenceStateKey(deviceId: string) {
    return `location:fence-state:${deviceId}`;
  }

  private buildSimulatorFallbackAddress(): ResolvedAddress {
    return {
      province: '',
      city: '',
      district: '',
      township: '',
      street: '',
      formattedAddress: '当前是模拟器或海外坐标，高德无法返回中国省市区地址',
      areaText: '海外/模拟器位置',
      shortText: '模拟器位置',
    };
  }

  private buildGeofencePayload(geofence: any | null) {
    if (!geofence) {
      return null;
    }

    return {
      id: geofence.id,
      name: geofence.name,
      centerLat: geofence.centerLat,
      centerLng: geofence.centerLng,
      radiusMeters: geofence.radiusMeters,
      enabled: geofence.enabled,
      updatedAt: geofence.updatedAt,
    };
  }

  private buildLocationPayload(
    location: {
      id: string;
      lat: number;
      lng: number;
      accuracy: number | null;
      source: string | null;
      timestamp: Date;
    } | null,
    address: ResolvedAddress | null,
  ) {
    if (!location) {
      return null;
    }

    return {
      id: location.id,
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
      source: location.source,
      timestamp: location.timestamp,
      address,
    };
  }

  private async resolveAddressesForHistory(
    points: Array<{
      id: string;
      lat: number;
      lng: number;
      accuracy: number | null;
      source: string | null;
      timestamp: Date;
    }>,
  ) {
    const bucketed = new Map<string, { lat: number; lng: number }>();
    for (const point of points) {
      const key = this.buildCoordinateBucketKey(point.lat, point.lng);
      if (!bucketed.has(key)) {
        bucketed.set(key, { lat: point.lat, lng: point.lng });
      }
    }

    const resolvedAddresses = new Map<string, ResolvedAddress | null>();
    const uniqueCoordinates = Array.from(bucketed.entries());
    const batchSize = 6;

    for (let index = 0; index < uniqueCoordinates.length; index += batchSize) {
      const batch = uniqueCoordinates.slice(index, index + batchSize);
      const batchResults = await Promise.all(
        batch.map(async ([key, coordinate]) => ({
          key,
          address: await this.reverseGeocode(coordinate.lat, coordinate.lng),
        })),
      );

      for (const item of batchResults) {
        resolvedAddresses.set(item.key, item.address);
      }
    }

    return points.map((point) => ({
      id: point.id,
      lat: point.lat,
      lng: point.lng,
      accuracy: point.accuracy,
      source: point.source,
      timestamp: point.timestamp,
      address: resolvedAddresses.get(this.buildCoordinateBucketKey(point.lat, point.lng)) ?? null,
    }));
  }

  private evaluateFence(
    geofence: {
      centerLat: number;
      centerLng: number;
      radiusMeters: number;
      enabled: boolean;
    } | null,
    location: { lat: number; lng: number } | null,
  ) {
    if (!geofence || !geofence.enabled || !location) {
      return {
        outsideFence: false,
        distanceMeters: null as number | null,
        exceededByMeters: null as number | null,
      };
    }

    const distanceMeters = this.calculateDistanceMeters(
      geofence.centerLat,
      geofence.centerLng,
      location.lat,
      location.lng,
    );
    const outsideFence = distanceMeters > geofence.radiusMeters;

    return {
      outsideFence,
      distanceMeters: Math.round(distanceMeters),
      exceededByMeters: outsideFence ? Math.round(distanceMeters - geofence.radiusMeters) : 0,
    };
  }

  private async reverseGeocode(lat: number, lng: number): Promise<ResolvedAddress | null> {
    const key = process.env.AMAP_WEB_API_KEY;
    if (!key) {
      return null;
    }

    const cacheKey = this.buildReverseGeocodeCacheKey(lat, lng);
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Partial<ResolvedAddress>;
        if (parsed?.shortText !== undefined) {
          return parsed as ResolvedAddress;
        }
        await this.redisService.del(cacheKey);
      } catch {
        await this.redisService.del(cacheKey);
      }
    }

    const simulatorFallback = this.buildSimulatorFallbackAddress();

    try {
      const search = new URLSearchParams({
        key,
        location: `${lng},${lat}`,
        extensions: 'base',
        roadlevel: '0',
      });

      const response = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${search.toString()}`);
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as any;
      if (payload?.status !== '1' || !payload?.regeocode?.addressComponent) {
        return null;
      }

      const component = payload.regeocode.addressComponent;
      const province = String(component.province || '').trim();
      const cityRaw = component.city;
      const city = Array.isArray(cityRaw)
        ? String(cityRaw[0] || '').trim()
        : String(cityRaw || '').trim();
      const district = String(component.district || '').trim();
      const township = String(component.township || '').trim();
      const street = String(component.streetNumber?.street || '').trim();
      const formattedAddress = String(payload.regeocode.formatted_address || '').trim();
      const areaText = this.buildAreaText(province, city || province, district);
      const shortText = this.buildShortText(district, township, street) || areaText;

      const resolved =
        !areaText && !formattedAddress && !shortText && !this.isLikelyMainlandChinaCoordinate(lat, lng)
          ? simulatorFallback
          : {
              province,
              city: city || province,
              district,
              township,
              street,
              formattedAddress,
              areaText,
              shortText,
            };

      await this.redisService.set(cacheKey, JSON.stringify(resolved), 60 * 60 * 12);
      return resolved;
    } catch (error) {
      console.warn('[LocationService] reverse geocode failed:', error);

      if (!this.isLikelyMainlandChinaCoordinate(lat, lng)) {
        await this.redisService.set(cacheKey, JSON.stringify(simulatorFallback), 60 * 60 * 12);
        return simulatorFallback;
      }

      return null;
    }
  }

  private async resolveElderDeviceForGuardian(guardianId: string, elderId?: string) {
    const guardianFamilies = await this.prisma.familyMember.findMany({
      where: { userId: guardianId, role: UserRole.GUARDIAN },
      select: { familyId: true },
    });

    const familyIds = guardianFamilies.map((item) => item.familyId);
    if (!familyIds.length) {
      throw new ForbiddenException('当前账号还没有绑定老人');
    }

    const elderMembership = await this.prisma.familyMember.findFirst({
      where: {
        familyId: { in: familyIds },
        role: UserRole.ELDER,
        ...(elderId ? { userId: elderId } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            deviceId: true,
          },
        },
      },
    });

    if (!elderMembership) {
      throw new BadRequestException('未找到对应的老人账号');
    }

    const device = await this.prisma.elderDevice.findFirst({
      where: {
        familyId: elderMembership.familyId,
        ...(elderMembership.user?.deviceId ? { deviceUuid: elderMembership.user.deviceId } : {}),
      },
      include: {
        geofence: true,
      },
      orderBy: { lastOnline: 'desc' },
    });

    if (!device) {
      throw new BadRequestException('当前老人账号还没有可用设备');
    }

    return {
      elderId: elderMembership.userId,
      elderName: elderMembership.user?.name || device.nickname || '家人',
      familyId: elderMembership.familyId,
      device,
    };
  }

  private async resolveElderDeviceForReport(requester: RequestUser) {
    if (requester.role !== UserRole.ELDER) {
      throw new ForbiddenException('只有老人端可以上报位置');
    }

    const elderMembership = await this.prisma.familyMember.findFirst({
      where: { userId: requester.userId, role: UserRole.ELDER },
      select: { familyId: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: requester.userId },
      select: { id: true, name: true, deviceId: true },
    });

    const deviceUuid = requester.deviceId || user?.deviceId;
    if (!deviceUuid) {
      throw new BadRequestException('当前账号缺少设备标识');
    }

    const device = await this.prisma.elderDevice.upsert({
      where: { deviceUuid },
      update: {
        lastOnline: new Date(),
        ...(elderMembership?.familyId ? { familyId: elderMembership.familyId } : {}),
        ...(user?.name ? { nickname: user.name } : {}),
      },
      create: {
        deviceUuid,
        lastOnline: new Date(),
        familyId: elderMembership?.familyId,
        nickname: user?.name || '老人',
      },
      include: {
        geofence: true,
      },
    });

    return {
      elderId: requester.userId,
      elderName: user?.name || device.nickname || '家人',
      familyId: elderMembership?.familyId || null,
      device,
    };
  }

  async reportLocation(requester: RequestUser, dto: ReportLocationDto) {
    const resolved = await this.resolveElderDeviceForReport(requester);
    const timestamp = dto.timestamp ? new Date(dto.timestamp) : new Date();

    if (Number.isNaN(timestamp.getTime())) {
      throw new BadRequestException('位置时间格式不正确');
    }

    const location = await this.prisma.locationTrack.create({
      data: {
        deviceId: resolved.device.id,
        lat: this.roundCoordinate(dto.lat),
        lng: this.roundCoordinate(dto.lng),
        accuracy: dto.accuracy,
        source: dto.source || 'gps',
        timestamp,
      },
    });

    await this.prisma.elderDevice.update({
      where: { id: resolved.device.id },
      data: { lastOnline: new Date() },
    });

    const address = await this.reverseGeocode(location.lat, location.lng);
    const fenceStatus = this.evaluateFence(resolved.device.geofence, {
      lat: location.lat,
      lng: location.lng,
    });
    const hasEnabledFence = Boolean(resolved.device.geofence?.enabled);
    const fenceStateKey = this.buildFenceStateKey(resolved.device.id);
    const previousFenceState = hasEnabledFence
      ? await this.redisService.get(fenceStateKey)
      : null;
    const currentFenceState = hasEnabledFence
      ? fenceStatus.outsideFence
        ? 'outside'
        : 'inside'
      : null;

    if (hasEnabledFence && currentFenceState) {
      await this.redisService.set(fenceStateKey, currentFenceState, 60 * 60 * 24 * 30);
    } else {
      await this.redisService.del(fenceStateKey);
    }

    const enteredOutside =
      hasEnabledFence && fenceStatus.outsideFence && previousFenceState !== 'outside';
    const returnedSafe =
      hasEnabledFence && !fenceStatus.outsideFence && previousFenceState === 'outside';

    if (resolved.familyId && enteredOutside) {
      this.signalingGateway.server.to(`family_${resolved.familyId}`).emit('location_fence_alert', {
        elderId: resolved.elderId,
        elderName: resolved.elderName,
        deviceId: resolved.device.id,
        location: this.buildLocationPayload(location, address),
        geofence: this.buildGeofencePayload(resolved.device.geofence),
        outsideFence: true,
        distanceMeters: fenceStatus.distanceMeters,
        exceededByMeters: fenceStatus.exceededByMeters,
      });
    }

    if (resolved.familyId && returnedSafe) {
      this.signalingGateway.server.to(`family_${resolved.familyId}`).emit('location_fence_safe', {
        elderId: resolved.elderId,
        elderName: resolved.elderName,
        deviceId: resolved.device.id,
        location: this.buildLocationPayload(location, address),
        geofence: this.buildGeofencePayload(resolved.device.geofence),
        outsideFence: false,
        distanceMeters: fenceStatus.distanceMeters,
        exceededByMeters: 0,
      });
    }

    return {
      success: true,
      data: {
        elderId: resolved.elderId,
        elderName: resolved.elderName,
        deviceId: resolved.device.id,
        location: this.buildLocationPayload(location, address),
        geofence: this.buildGeofencePayload(resolved.device.geofence),
        outsideFence: fenceStatus.outsideFence,
        distanceMeters: fenceStatus.distanceMeters,
        exceededByMeters: fenceStatus.exceededByMeters,
      },
    };
  }

  async getLatestLocation(requester: RequestUser, query: GetLatestLocationDto) {
    if (requester.role !== UserRole.GUARDIAN) {
      throw new ForbiddenException('只有守护端可以查看定位');
    }

    const resolved = await this.resolveElderDeviceForGuardian(requester.userId, query.elderId);
    const latest = await this.prisma.locationTrack.findFirst({
      where: { deviceId: resolved.device.id },
      orderBy: { timestamp: 'desc' },
    });

    const address = latest ? await this.reverseGeocode(latest.lat, latest.lng) : null;
    const fenceStatus = this.evaluateFence(
      resolved.device.geofence,
      latest ? { lat: latest.lat, lng: latest.lng } : null,
    );

    return {
      success: true,
      data: {
        elderId: resolved.elderId,
        elderName: resolved.elderName,
        deviceId: resolved.device.id,
        deviceUuid: resolved.device.deviceUuid,
        location: this.buildLocationPayload(latest, address),
        geofence: this.buildGeofencePayload(resolved.device.geofence),
        outsideFence: fenceStatus.outsideFence,
        distanceMeters: fenceStatus.distanceMeters,
        exceededByMeters: fenceStatus.exceededByMeters,
      },
    };
  }

  async getHistory(requester: RequestUser, query: GetLocationHistoryDto) {
    if (requester.role !== UserRole.GUARDIAN) {
      throw new ForbiddenException('只有守护端可以查看轨迹');
    }

    const resolved = await this.resolveElderDeviceForGuardian(requester.userId, query.elderId);
    const hours = query.hours ?? 24;
    const limit = query.limit ?? 200;
    const fromTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const history = await this.prisma.locationTrack.findMany({
      where: {
        deviceId: resolved.device.id,
        timestamp: {
          gte: fromTime,
        },
      },
      orderBy: { timestamp: 'asc' },
      take: limit,
    });

    const points = await this.resolveAddressesForHistory(history);

    return {
      success: true,
      data: {
        elderId: resolved.elderId,
        elderName: resolved.elderName,
        deviceId: resolved.device.id,
        hours,
        fromTime,
        points,
      },
    };
  }

  async getGeofence(requester: RequestUser, query: GetLatestLocationDto) {
    if (requester.role !== UserRole.GUARDIAN) {
      throw new ForbiddenException('只有守护端可以查看电子围栏');
    }

    const resolved = await this.resolveElderDeviceForGuardian(requester.userId, query.elderId);

    return {
      success: true,
      data: {
        elderId: resolved.elderId,
        elderName: resolved.elderName,
        deviceId: resolved.device.id,
        geofence: this.buildGeofencePayload(resolved.device.geofence),
      },
    };
  }

  async upsertGeofence(requester: RequestUser, dto: UpsertGeofenceDto) {
    if (requester.role !== UserRole.GUARDIAN) {
      throw new ForbiddenException('只有守护端可以配置电子围栏');
    }

    const resolved = await this.resolveElderDeviceForGuardian(requester.userId, dto.elderId);

    const geofence = await this.prisma.locationGeofence.upsert({
      where: { deviceId: resolved.device.id },
      create: {
        deviceId: resolved.device.id,
        name: dto.name?.trim() || '默认电子围栏',
        centerLat: this.roundCoordinate(dto.centerLat),
        centerLng: this.roundCoordinate(dto.centerLng),
        radiusMeters: this.normalizeRadius(dto.radiusMeters),
        enabled: dto.enabled ?? true,
      },
      update: {
        name: dto.name?.trim() || '默认电子围栏',
        centerLat: this.roundCoordinate(dto.centerLat),
        centerLng: this.roundCoordinate(dto.centerLng),
        radiusMeters: this.normalizeRadius(dto.radiusMeters),
        enabled: dto.enabled ?? true,
      },
    });

    return {
      success: true,
      data: {
        elderId: resolved.elderId,
        elderName: resolved.elderName,
        deviceId: resolved.device.id,
        geofence: this.buildGeofencePayload(geofence),
      },
    };
  }
}
