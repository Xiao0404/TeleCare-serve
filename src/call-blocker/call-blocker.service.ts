import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { SignalingGateway } from '../signaling/signaling.gateway';
import { UpsertBlacklistDto } from './dto/upsert-blacklist.dto';

@Injectable()
export class CallBlockerService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private signalingGateway: SignalingGateway,
    private httpService: HttpService,
  ) {}

  private async resolveFamilyId(userId: string): Promise<string> {
    const member = await this.prisma.familyMember.findFirst({
      where: { userId },
      select: { familyId: true },
    });
    if (!member) throw new ForbiddenException('当前账号还没有绑定家庭');
    return member.familyId;
  }

  private normalizeRule(raw: string) {
    const cleaned = raw.replace(/[^\d+]/g, '').trim();
    const hadPlus = cleaned.startsWith('+');
    let n = cleaned.replace(/\D/g, '').trim();
    if (n.startsWith('0086')) n = n.substring(4);
    else if (hadPlus && n.startsWith('86')) n = n.substring(2);
    else if (n.startsWith('86') && n.length > 11) n = n.substring(2);
    else if (hadPlus && n.startsWith('1') && n.length === 11) n = n.substring(1);
    return n;
  }

  async upsertBlacklist(userId: string, dto: UpsertBlacklistDto) {
    const familyId = await this.resolveFamilyId(userId);
    const normalized = [
      ...new Set(
        dto.numbers
          .map((n) => this.normalizeRule(n))
          .filter((n) => n.length >= 2),
      ),
    ];

    if (normalized.length === 0) {
      throw new HttpException(
        '请输入至少 2 位的号码或号段',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.$transaction(
      normalized.map((phoneNumber) =>
        this.prisma.callBlacklist.upsert({
          where: { familyId_phoneNumber: { familyId, phoneNumber } },
          create: { familyId, phoneNumber, source: 'guardian' },
          update: { source: 'guardian' },
        }),
      ),
    );

    await this.pushToElder(familyId);
    return { success: true };
  }

  async removeNumber(userId: string, phoneNumber: string) {
    const familyId = await this.resolveFamilyId(userId);
    const normalized = this.normalizeRule(phoneNumber);
    await this.prisma.callBlacklist.deleteMany({
      where: { familyId, phoneNumber: normalized },
    });
    await this.pushToElder(familyId);
    return { success: true };
  }

  async getBlacklist(userId: string) {
    const familyId = await this.resolveFamilyId(userId);
    const records = await this.prisma.callBlacklist.findMany({
      where: { familyId },
      select: { phoneNumber: true, source: true, note: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      numbers: records.map((r) => r.phoneNumber),
      detail: records,
    };
  }

  async syncPublicList(userId: string) {
    const familyId = await this.resolveFamilyId(userId);

    // 60 秒内同一用户只允许触发一次
    const rateLimitKey = `sync_public_ratelimit:${userId}`;
    const locked = await this.redisService.get(rateLimitKey);
    if (locked) {
      throw new HttpException(
        '同步过于频繁，请 60 秒后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.redisService.set(rateLimitKey, '1', 60);

    // 内置常见骚扰号码段（可持续扩充）
    const builtinPrefixes = [
      '4006',
      '4007',
      '4008',
      '4009', // 400 客服/骚扰
      '01',
      '02',
      '03', // 非标准短号
    ];

    // 尝试从可访问的公开源拉取，失败则用内置列表
    let numbers: string[] = [];
    const sources = [
      'https://gitee.com/mirrors/phone-blacklist/raw/master/blacklist.txt',
    ];

    for (const url of sources) {
      try {
        const response = (await firstValueFrom(
          this.httpService.get<string>(url, {
            responseType: 'text',
            timeout: 8000,
          }),
        )) as AxiosResponse<string>;

        numbers = (response.data as string)
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#') && /^\+?[\d]{7,}$/.test(l))
          .map((l) => l.replace(/^(0086|86)(?=\d{11}$)/, ''));

        if (numbers.length > 0) break;
      } catch {
        // 继续尝试下一个源
      }
    }

    // 外部源都失败时使用内置列表
    if (numbers.length === 0) {
      numbers = builtinPrefixes;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < numbers.length; i += 500) {
      chunks.push(numbers.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      await this.prisma.$transaction(
        chunk.map((phoneNumber) =>
          this.prisma.callBlacklist.upsert({
            where: { familyId_phoneNumber: { familyId, phoneNumber } },
            create: { familyId, phoneNumber, source: 'public' },
            update: {},
          }),
        ),
      );
    }

    await this.pushToElder(familyId);
    return { success: true, count: numbers.length };
  }

  private async pushToElder(familyId: string) {
    const records = await this.prisma.callBlacklist.findMany({
      where: { familyId },
      select: { phoneNumber: true },
    });
    this.signalingGateway.server
      .to(`family_${familyId}`)
      .emit('sync_blacklist', { numbers: records.map((r) => r.phoneNumber) });
  }
}
