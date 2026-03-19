import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../common/redis/redis.service';
import { PrismaService } from '../common/prisma/prisma.service';

interface AuthSocket extends Socket {
  userId: string;
  familyId: string;
  deviceUuid?: string;
}

@WebSocketGateway({ namespace: '/care', cors: { origin: '*' } })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SignalingGateway.name);

  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) throw new WsException('缺少 token');

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'telecare_secret_key',
      });

      const userId: string = payload.sub;

      // 查找该用户所在的 familyId
      const membership = await this.prisma.familyMember.findFirst({
        where: { userId },
        select: { familyId: true },
      });

      if (!membership) {
        // 未绑定家庭也允许连接，但不加入房间（老人端绑定前状态）
        client.userId = userId;
        client.familyId = '';
        this.logger.log(`Client connected (no family): ${client.id} userId=${userId}`);
        return;
      }

      client.userId = userId;
      client.familyId = membership.familyId;

      await client.join(`family_${membership.familyId}`);
      this.logger.log(
        `Client connected: ${client.id} userId=${userId} familyId=${membership.familyId}`,
      );
    } catch (err) {
      this.logger.warn(`Connection rejected: ${err.message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthSocket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // 清理 Redis 中的 socketId（如果存在）
    if (client.deviceUuid) {
      const key = `device_status:${client.deviceUuid}`;
      const socketId = await this.redisService.hget(key, 'socketId');
      if (socketId === client.id) {
        await this.redisService.hset(key, 'status', 'OFFLINE');
        await this.redisService.hset(key, 'socketId', '');
      }
    }
  }

  // ─── 心跳 ────────────────────────────────────────────────────────────────────

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { battery: number; netType: string; deviceUuid?: string; deviceId?: string },
  ) {
    const battery = data?.battery;
    const netType = data?.netType;
    const deviceUuid = data?.deviceUuid || data?.deviceId;
    if (!deviceUuid) return { event: 'heartbeat_ack', data: { ok: false, reason: 'missing_device_uuid' } };

    client.deviceUuid = deviceUuid;
    const key = `device_status:${deviceUuid}`;

    await this.redisService.hset(key, 'socketId', client.id);
    await this.redisService.hset(key, 'battery', battery ?? 0);
    await this.redisService.hset(key, 'status', 'IDLE');
    await this.redisService.hset(key, 'netType', netType ?? '');
    await this.redisService.expire(key, 60);

    const membership = await this.prisma.familyMember.findFirst({
      where: { userId: client.userId, role: 'ELDER' },
      select: { familyId: true },
    });

    // 同步更新 DB 的 battery / lastOnline，若老人账号已有 family，则自动补齐 familyId
    await this.prisma.elderDevice.upsert({
      where: { deviceUuid },
      update: {
        battery,
        lastOnline: new Date(),
        ...(membership?.familyId ? { familyId: membership.familyId } : {}),
      },
      create: {
        deviceUuid,
        battery,
        lastOnline: new Date(),
        ...(membership?.familyId ? { familyId: membership.familyId } : {}),
      },
    });

    return { event: 'heartbeat_ack', data: { ok: true } };
  }

  // ─── 呼叫与 SOS ──────────────────────────────────────────────────────────────

  @SubscribeMessage('sos_trigger')
  async handleSosTrigger(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { lat: number; lng: number; battery: number; deviceUuid: string },
  ) {
    const { deviceUuid } = data;
    if (!client.familyId) return;

    // SOS 防误触锁（30s）
    const lockKey = `sos_lock:${deviceUuid}`;
    const locked = await this.redisService.get(lockKey);
    if (locked) return { event: 'sos_ack', data: { throttled: true } };

    await this.redisService.set(lockKey, '1', 30);
    this.server.to(`family_${client.familyId}`).emit('sos_trigger', data);
    return { event: 'sos_ack', data: { ok: true } };
  }

  @SubscribeMessage('call_guardian')
  handleCallGuardian(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { deviceId: string },
  ) {
    if (!client.familyId) return;
    this.server.to(`family_${client.familyId}`).emit('call_guardian', {
      ...data,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('request_assist')
  handleRequestAssist(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { guardianId: string; name: string; targetSocketId: string },
  ) {
    const { targetSocketId, ...payload } = data;
    this.server.to(targetSocketId).emit('request_assist', payload);
  }

  @SubscribeMessage('assist_reply')
  handleAssistReply(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { accept: boolean; targetSocketId: string },
  ) {
    const { targetSocketId, ...payload } = data;
    this.server.to(targetSocketId).emit('assist_reply', payload);
  }

  // ─── WebRTC 信令透传 ──────────────────────────────────────────────────────────

  @SubscribeMessage('webrtc_offer')
  handleOffer(@MessageBody() data: { targetId: string; sdp: string }) {
    this.server.to(data.targetId).emit('webrtc_offer', data);
  }

  @SubscribeMessage('webrtc_answer')
  handleAnswer(@MessageBody() data: { targetId: string; sdp: string }) {
    this.server.to(data.targetId).emit('webrtc_answer', data);
  }

  @SubscribeMessage('webrtc_ice')
  handleIce(@MessageBody() data: { targetId: string; candidate: unknown }) {
    this.server.to(data.targetId).emit('webrtc_ice', data);
  }

  @SubscribeMessage('call_end')
  handleCallEnd(@MessageBody() data: { targetId: string; reason: string }) {
    this.server.to(data.targetId).emit('call_end', data);
  }

  // ─── 远程控制 ─────────────────────────────────────────────────────────────────

  @SubscribeMessage('remote_command')
  handleRemoteCommand(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { targetSocketId: string; action: string; params: unknown },
  ) {
    const { targetSocketId, ...payload } = data;
    this.server.to(targetSocketId).emit('remote_command', payload);
  }

  // ─── 对外暴露：定向推送 bind_success ─────────────────────────────────────────

  async sendBindSuccess(deviceUuid: string, familyId: string) {
    const key = `device_status:${deviceUuid}`;
    const socketId = await this.redisService.hget(key, 'socketId');
    if (socketId) {
      this.server.to(socketId).emit('bind_success', { familyId });
    }
  }
}
