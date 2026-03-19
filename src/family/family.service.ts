import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UnbindFamilyDto } from './dto/unbind-family.dto';

@Injectable()
export class FamilyService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async getFamilyMembers(userId: string, role: UserRole) {
    if (role === UserRole.GUARDIAN) {
      // 守护端：查找自己绑定的老人
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
      // 老人端：找到自己所在的 Family，再查所有守护端成员
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
    // 查守护端所在的所有 family
    const myFamilies = await this.prisma.familyMember.findMany({
      where: { userId, role: 'GUARDIAN' },
      select: { familyId: true },
    });

    const familyIds = myFamilies.map((f) => f.familyId);
    if (familyIds.length === 0) return { devices: [], stats: { total: 0, online: 0 } };

    // 查每个 family 下的老人设备
    const devices = await this.prisma.elderDevice.findMany({
      where: { familyId: { in: familyIds } },
      select: {
        id: true,
        deviceUuid: true,
        nickname: true,
        battery: true,
        lastOnline: true,
        familyId: true,
      },
    });

    // 从 Redis 读取实时在线状态
    const enriched = await Promise.all(
      devices.map(async (device) => {
        const status = await this.redisService.hgetall(`device_status:${device.deviceUuid}`);
        const isOnline = !!status?.socketId;
        return {
          ...device,
          online: isOnline,
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
