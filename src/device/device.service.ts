import { Injectable, BadRequestException } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class DeviceService {
  constructor(
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  /**
   * 生成 6 位配对码，存入 Redis，TTL 5分钟
   */
  async generatePairCode(elderId: string) {
    // 生成 6 位随机数字
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `bind_code:${code}`;
    
    // 检查是否冲突（虽然概率极低）
    const exists = await this.redisService.get(key);
    if (exists) {
        return this.generatePairCode(elderId); // Retry
    }

    // 存入 Redis: bind_code:123456 -> elderId
    await this.redisService.set(key, elderId, 300);

    return {
      pairCode: code,
      expiresIn: 300,
    };
  }

  /**
   * 校验配对码，返回关联的老人 ID
   */
  async verifyPairCode(code: string): Promise<string> {
      const key = `bind_code:${code}`;
      const elderId = await this.redisService.get(key);
      
      if (!elderId) {
          throw new BadRequestException('配对码无效或已过期');
      }
      
      return elderId;
  }
  
  /**
   * 删除配对码 (绑定成功后调用)
   */
  async deletePairCode(code: string) {
      await this.redisService.del(`bind_code:${code}`);
  }

  /**
   * 绑定设备 (Prisma 事务)
   */
  async bindDevice(guardianId: string, code: string, nickname?: string) {
      // 1. 校验配对码
      const elderId = await this.verifyPairCode(code);
      
      // 2. 开启事务处理
      const result = await this.prisma.$transaction(async (prisma) => {
          // A. 查找或创建老人的家庭 (Family)
          // 这里简化逻辑：我们假设一个老人对应一个 Family。
          // 先查 FamilyMember 表看该老人是否已经属于某个 Family
          let familyMember = await prisma.familyMember.findFirst({
              where: { userId: elderId },
              include: { family: true }
          });
          
          let familyId: string;

          if (!familyMember) {
              // 如果老人还没有 Family，创建一个新的
              const newFamily = await prisma.family.create({
                  data: {}
              });
              familyId = newFamily.id;
              
              // 将老人加入 Family (Role: ELDER? Schema 目前 FamilyMember role default GUARDIAN，这里可能需要注意)
              // 我们约定老人在 FamilyMember 中 role 为 'ELDER' (虽然 Schema default 是 GUARDIAN)
              await prisma.familyMember.create({
                  data: {
                      userId: elderId,
                      familyId: familyId,
                      role: 'ELDER' 
                  }
              });
          } else {
              familyId = familyMember.familyId;
          }

          // B. 检查守护者是否已绑定过其他老人（一个守护端只能绑定一个老人）
          const existingGuardianBinding = await prisma.familyMember.findFirst({
              where: { userId: guardianId, role: 'GUARDIAN' },
          });

          if (existingGuardianBinding && existingGuardianBinding.familyId !== familyId) {
              throw new BadRequestException('守护端已绑定一个老人，请先解绑后再绑定新的老人');
          }

          // C. 检查守护者是否已经在该 Family 中
          const existingGuardian = await prisma.familyMember.findUnique({
              where: {
                  userId_familyId: {
                      userId: guardianId,
                      familyId: familyId
                  }
              }
          });

          if (existingGuardian) {
              return { message: '您已绑定该老人', familyId };
          }

          // D. 将守护者加入 Family
          await prisma.familyMember.create({
              data: {
                  userId: guardianId,
                  familyId: familyId,
                  role: 'GUARDIAN'
              }
          });

          // E. 将老人账号当前登录的设备挂到该 family 上
          const elderUser = await prisma.user.findUnique({
              where: { id: elderId },
              select: { deviceId: true, name: true },
          });

          if (elderUser?.deviceId) {
              await prisma.elderDevice.upsert({
                  where: { deviceUuid: elderUser.deviceId },
                  update: {
                      familyId,
                      ...(nickname ? { nickname } : {}),
                  },
                  create: {
                      deviceUuid: elderUser.deviceId,
                      familyId,
                      nickname: nickname || elderUser.name || '老人',
                  },
              });
          }
          
          return { success: true, familyId };
      });

      // 3. 删除配对码
      await this.deletePairCode(code);

      return result;
  }
}
