import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UnbindFamilyDto } from './dto/unbind-family.dto';
import { SignalingGateway } from '../signaling/signaling.gateway';
import { GetRemoteConfigDto } from './dto/get-remote-config.dto';
import { UpdateRemoteConfigDto } from './dto/update-remote-config.dto';

@Injectable()
export class FamilyService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private signalingGateway: SignalingGateway,
  ) {}

  private async resolveGuardianTargetDevice(userId: string, elderId?: string) {
    const myFamilies = await this.prisma.familyMember.findMany({
      where: { userId, role: UserRole.GUARDIAN },
      select: { familyId: true },
    });

    const familyIds = myFamilies.map((item) => item.familyId);
    if (familyIds.length === 0) {
      throw new ForbiddenException('当前账号还没有绑定老人');
    }

    const elderMembership = await this.prisma.familyMember.findFirst({
      where: {
        familyId: { in: familyIds },
        role: UserRole.ELDER,
        ...(elderId ? { userId: elderId } : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    if (!elderMembership) {
      throw new BadRequestException('未找到对应的老人账号');
    }

    const device = await this.prisma.elderDevice.findFirst({
      where: { familyId: elderMembership.familyId },
      include: { config: true },
      orderBy: { lastOnline: 'desc' },
    });

    if (!device) {
      throw new BadRequestException('当前老人账号还没有可用设备');
    }

    const status = await this.redisService.hgetall(`device_status:${device.deviceUuid}`);
    const socketId = status?.socketId?.trim?.() || null;

    return {
      elderMembership,
      device,
      socketId,
    };
  }

  private normalizeReminderTimes(input?: unknown): string[] {
    if (!Array.isArray(input)) {
      return [];
    }

    return input
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  private clampPercent(value: unknown, fallback = 50) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private buildRemoteConfigPayload(config: {
    elderId: string;
    deviceId: string;
    volume?: number | null;
    ringVolume?: number | null;
    notificationVolume?: number | null;
    alarmVolume?: number | null;
    brightness?: number | null;
    muted?: boolean | null;
    medicineReminderTimes?: string[];
    allowedApps?: string[];
    updatedAt?: string;
  }) {
    const medicineReminderTimes = this.normalizeReminderTimes(config.medicineReminderTimes);

    return {
      elderId: config.elderId,
      deviceId: config.deviceId,
      volume: this.clampPercent(config.volume, 50),
      ringVolume: this.clampPercent(config.ringVolume, 50),
      notificationVolume: this.clampPercent(config.notificationVolume, 50),
      alarmVolume: this.clampPercent(config.alarmVolume, 50),
      brightness: this.clampPercent(config.brightness, 50),
      muted: Boolean(config.muted),
      medicineReminderTimes,
      medicineReminderEnabled: medicineReminderTimes.length > 0,
      allowedApps: this.normalizeReminderTimes(config.allowedApps),
      updatedAt: config.updatedAt || new Date().toISOString(),
    };
  }

  async getRemoteConfig(
    requester: { userId: string; role: UserRole },
    query: GetRemoteConfigDto,
  ) {
    if (requester.role !== UserRole.GUARDIAN) {
      throw new ForbiddenException('只有守护端可以读取远程配置');
    }

    const { elderMembership, device, socketId } = await this.resolveGuardianTargetDevice(
      requester.userId,
      query.elderId,
    );

    const reminderTimes = this.normalizeReminderTimes(device.config?.medicineReminder);
    const allowedApps = this.normalizeReminderTimes(device.config?.allowedApps);
    const savedPayload = this.buildRemoteConfigPayload({
      elderId: elderMembership.userId,
      deviceId: device.id,
      volume: device.config?.volume,
      ringVolume: (device.config as any)?.ringVolume,
      notificationVolume: (device.config as any)?.notificationVolume,
      alarmVolume: (device.config as any)?.alarmVolume,
      brightness: device.config?.brightness,
      muted: (device.config as any)?.muted,
      medicineReminderTimes: reminderTimes,
      allowedApps,
    });

    return {
      success: true,
      data: {
        elderId: elderMembership.userId,
        elderName: elderMembership.user?.name || device.nickname || '家人',
        deviceId: device.id,
        deviceUuid: device.deviceUuid,
        online: Boolean(socketId),
        config: savedPayload,
      },
    };
  }

  async updateRemoteConfig(
    requester: { userId: string; role: UserRole },
    dto: UpdateRemoteConfigDto,
  ) {
    if (requester.role !== UserRole.GUARDIAN) {
      throw new ForbiddenException('只有守护端可以更新远程配置');
    }

    const { elderMembership, device, socketId } = await this.resolveGuardianTargetDevice(
      requester.userId,
      dto.elderId,
    );

    const medicineReminderTimes = this.normalizeReminderTimes(dto.medicineReminderTimes);
    const nextAllowedApps =
      dto.allowedApps !== undefined
        ? this.normalizeReminderTimes(dto.allowedApps)
        : this.normalizeReminderTimes(device.config?.allowedApps);

    const saved = await this.prisma.remoteConfig.upsert({
      where: { deviceId: device.id },
      create: {
        deviceId: device.id,
        volume: dto.volume,
        ringVolume: dto.ringVolume ?? 50,
        notificationVolume: dto.notificationVolume ?? 50,
        alarmVolume: dto.alarmVolume ?? 50,
        brightness: dto.brightness,
        muted: Boolean(dto.muted),
        medicineReminder: medicineReminderTimes,
        allowedApps: nextAllowedApps,
      },
      update: {
        volume: dto.volume,
        ringVolume: dto.ringVolume ?? 50,
        notificationVolume: dto.notificationVolume ?? 50,
        alarmVolume: dto.alarmVolume ?? 50,
        brightness: dto.brightness,
        muted: Boolean(dto.muted),
        medicineReminder: medicineReminderTimes,
        allowedApps: nextAllowedApps,
      },
    });

    const payload = this.buildRemoteConfigPayload({
      elderId: elderMembership.userId,
      deviceId: device.id,
      volume: saved.volume,
      ringVolume: (saved as any).ringVolume,
      notificationVolume: (saved as any).notificationVolume,
      alarmVolume: (saved as any).alarmVolume,
      brightness: saved.brightness,
      muted: (saved as any).muted,
      medicineReminderTimes,
      allowedApps: nextAllowedApps,
      updatedAt: new Date().toISOString(),
    });

    if (socketId) {
      this.signalingGateway.server.to(socketId).emit('sync_config', payload);
    }

    return {
      success: true,
      data: {
        ...payload,
        online: Boolean(socketId),
        pushed: Boolean(socketId),
      },
    };
  }

  async getFamilyMembers(userId: string, role: UserRole) {
    if (role === UserRole.GUARDIAN) {
      const myFamilies = await this.prisma.familyMember.findMany({
        where: { userId, role: 'GUARDIAN' },
        select: { familyId: true },
      });

      const familyIds = myFamilies.map((f) => f.familyId);
      if (familyIds.length === 0) return [];

      const elders = await this.prisma.familyMember.findMany({
        where: { familyId: { in: familyIds }, role: 'ELDER' },
        include: {
          user: { select: { id: true, name: true, phone: true, deviceId: true } },
        },
      });

      return elders.map((member) => ({
        familyId: member.familyId,
        userId: member.userId,
        role: 'ELDER',
        name: member.user.name || '老人',
        phone: member.user.phone,
        deviceId: member.user.deviceId,
      }));
    }

    if (role === UserRole.ELDER) {
      const elderMembership = await this.prisma.familyMember.findFirst({
        where: { userId, role: 'ELDER' },
        select: { familyId: true },
      });

      if (!elderMembership) return [];

      const guardians = await this.prisma.familyMember.findMany({
        where: { familyId: elderMembership.familyId, role: 'GUARDIAN' },
        include: {
          user: { select: { id: true, name: true, phone: true, deviceId: true } },
        },
      });

      return guardians.map((member) => ({
        familyId: member.familyId,
        userId: member.userId,
        role: 'GUARDIAN',
        name: member.user.name || '守护者',
        phone: member.user.phone,
        deviceId: member.user.deviceId,
      }));
    }

    return [];
  }

  async unbind(requester: { userId: string; role: UserRole }, dto: UnbindFamilyDto) {
    if (requester.role === UserRole.GUARDIAN) {
      if (!dto.elderId) {
        throw new BadRequestException('守护端取消绑定时 elderId 必填');
      }

      const elderMembership = await this.prisma.familyMember.findFirst({
        where: { userId: dto.elderId, role: UserRole.ELDER },
      });

      if (!elderMembership) {
        throw new BadRequestException('未找到老人绑定关系');
      }

      const guardianMembership = await this.prisma.familyMember.findUnique({
        where: {
          userId_familyId: {
            userId: requester.userId,
            familyId: elderMembership.familyId,
          },
        },
      });

      if (!guardianMembership) {
        throw new ForbiddenException('该守护者未绑定该老人');
      }

      await this.prisma.familyMember.delete({
        where: {
          userId_familyId: {
            userId: requester.userId,
            familyId: elderMembership.familyId,
          },
        },
      });

      const remainingGuardians = await this.prisma.familyMember.count({
        where: {
          familyId: elderMembership.familyId,
          role: UserRole.GUARDIAN,
        },
      });

      return {
        success: true,
        initiatedBy: UserRole.GUARDIAN,
        familyId: elderMembership.familyId,
        removed: {
          elderId: dto.elderId,
          guardianId: requester.userId,
        },
        remainingGuardians,
      };
    }

    if (requester.role === UserRole.ELDER) {
      if (!dto.guardianId) {
        throw new BadRequestException('老人端取消绑定时 guardianId 必填');
      }

      const elderMembership = await this.prisma.familyMember.findFirst({
        where: { userId: requester.userId, role: UserRole.ELDER },
      });

      if (!elderMembership) {
        throw new BadRequestException('老人未绑定任何家庭');
      }

      const guardianMembership = await this.prisma.familyMember.findUnique({
        where: {
          userId_familyId: {
            userId: dto.guardianId,
            familyId: elderMembership.familyId,
          },
        },
      });

      if (!guardianMembership || guardianMembership.role !== UserRole.GUARDIAN) {
        throw new BadRequestException('未找到该家人绑定关系');
      }

      await this.prisma.familyMember.delete({
        where: {
          userId_familyId: {
            userId: dto.guardianId,
            familyId: elderMembership.familyId,
          },
        },
      });

      const remainingGuardians = await this.prisma.familyMember.count({
        where: {
          familyId: elderMembership.familyId,
          role: UserRole.GUARDIAN,
        },
      });

      return {
        success: true,
        initiatedBy: UserRole.ELDER,
        familyId: elderMembership.familyId,
        removed: {
          elderId: requester.userId,
          guardianId: dto.guardianId,
        },
        remainingGuardians,
      };
    }

    throw new ForbiddenException('当前角色不支持取消绑定');
  }

  async getDashboard(userId: string) {
    const myFamilies = await this.prisma.familyMember.findMany({
      where: { userId, role: 'GUARDIAN' },
      select: { familyId: true },
    });

    const familyIds = myFamilies.map((f) => f.familyId);
    if (familyIds.length === 0) return { devices: [], stats: { total: 0, online: 0 } };

    const elderMembers = await this.prisma.familyMember.findMany({
      where: { familyId: { in: familyIds }, role: 'ELDER' },
      include: {
        user: { select: { id: true, name: true, phone: true, deviceId: true } },
      },
    });

    const elderByFamilyId = new Map(
      elderMembers.map((member) => [member.familyId, member]),
    );

    // 每个 family 只取最近活跃的那台设备（同一账号同一时间只登录一台）
    const latestDevices = await Promise.all(
      familyIds.map((familyId) =>
        this.prisma.elderDevice.findFirst({
          where: { familyId },
          orderBy: { lastOnline: 'desc' },
          select: {
            id: true,
            deviceUuid: true,
            nickname: true,
            battery: true,
            lastOnline: true,
            familyId: true,
          },
        }),
      ),
    );

    const devices = latestDevices.filter((d): d is NonNullable<typeof d> => d !== null);

    const enriched = await Promise.all(
      devices.map(async (device) => {
        const status = await this.redisService.hgetall(`device_status:${device.deviceUuid}`);
        const socketId = status?.socketId?.trim?.() || null;
        const isOnline = !!socketId;
        const elderMember = elderByFamilyId.get(device.familyId || '');

        return {
          ...device,
          deviceId: device.deviceUuid,
          elderId: elderMember?.userId || null,
          elderName: elderMember?.user?.name || device.nickname || '老人',
          online: isOnline,
          isCallable: isOnline,
          socketId,
          battery: status?.battery ? Number(status.battery) : device.battery,
          status: status?.status || 'OFFLINE',
        };
      }),
    );

    const onlineCount = enriched.filter((d) => d.online).length;

    return {
      devices: enriched,
      stats: {
        total: enriched.length,
        online: onlineCount,
      },
    };
  }
}
