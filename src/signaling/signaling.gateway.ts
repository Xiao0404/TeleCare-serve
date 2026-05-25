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
import { randomUUID } from 'crypto';

interface AuthSocket extends Socket {
  userId: string;
  familyId: string;
  deviceUuid?: string;
}

interface AssistSession {
  sessionId: string;
  familyId: string;
  initiatorSocketId: string;
  targetSocketId?: string | null;
  initiatorUserId: string;
  targetElderId?: string;
  status: 'requesting' | 'accepted' | 'connecting' | 'controlling' | 'declined' | 'ended';
}

@WebSocketGateway({ namespace: '/care', cors: { origin: '*' } })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SignalingGateway.name);
  private readonly assistSessions = new Map<string, AssistSession>();
  private readonly currentConfigRequests = new Map<
    string,
    {
      resolve: (value: any | null) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  async requestCurrentRemoteConfig(targetSocketId: string, timeoutMs = 3000): Promise<any | null> {
    const requestId = randomUUID();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.currentConfigRequests.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.currentConfigRequests.set(requestId, {
        resolve,
        timeout,
      });

      this.server.to(targetSocketId).emit('current_remote_config_request', {
        requestId,
      });
    });
  }

  private emitSessionState(
    session: AssistSession,
    extra?: Record<string, unknown>,
    targetSocketIds?: Array<string | null | undefined>,
  ) {
    const recipients = (targetSocketIds?.length
      ? targetSocketIds
      : [session.initiatorSocketId, session.targetSocketId]
    ).filter((socketId): socketId is string => Boolean(socketId));

    recipients.forEach((socketId) => {
      const counterpartSocketId =
        socketId === session.initiatorSocketId ? session.targetSocketId || undefined : session.initiatorSocketId;

      const payload = {
        sessionId: session.sessionId,
        status: session.status,
        initiatorSocketId: session.initiatorSocketId,
        targetSocketId: session.targetSocketId || undefined,
        counterpartSocketId,
        ...extra,
      };

      this.server.to(socketId).emit('session_state', payload);
    });
  }

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

      const membership = await this.prisma.familyMember.findFirst({
        where: { userId },
        select: { familyId: true },
      });

      if (!membership) {
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

    if (client.deviceUuid) {
      const key = `device_status:${client.deviceUuid}`;
      const socketId = await this.redisService.hget(key, 'socketId');
      if (socketId === client.id) {
        await this.redisService.hset(key, 'status', 'OFFLINE');
        await this.redisService.hset(key, 'socketId', '');
      }
    }

    for (const [sessionId, session] of this.assistSessions.entries()) {
      if (session.status === 'ended' || session.status === 'declined') continue;
      if (session.initiatorSocketId !== client.id && session.targetSocketId !== client.id) continue;

      session.status = 'ended';
      this.assistSessions.set(sessionId, session);

      const counterpartId = session.initiatorSocketId === client.id
        ? session.targetSocketId
        : session.initiatorSocketId;

      this.emitSessionState(session, { reason: 'disconnect' }, [client.id, counterpartId]);

      if (counterpartId) {
        this.server.to(counterpartId).emit('call_end', {
          sessionId,
          reason: 'disconnect',
          targetId: counterpartId,
        });
      } else {
        this.server.to(`family_${session.familyId}`).emit('call_end', {
          sessionId,
          reason: 'disconnect',
        });
      }

      this.assistSessions.delete(sessionId);
    }
  }

  private async resolveTargetSocketId(params: {
    familyId: string;
    elderId?: string;
    deviceId?: string;
    targetSocketId?: string;
  }): Promise<string | null> {
    const { familyId, elderId, deviceId, targetSocketId } = params;

    if (targetSocketId) {
      return targetSocketId;
    }

    let resolvedDeviceId = deviceId;

    if (!resolvedDeviceId && elderId) {
      const elderUser = await this.prisma.user.findUnique({
        where: { id: elderId },
        select: { id: true, role: true, deviceId: true },
      });

      if (elderUser?.role === 'ELDER' && elderUser.deviceId) {
        resolvedDeviceId = elderUser.deviceId;
      }
    }

    if (!resolvedDeviceId && elderId) {
      const elderDevice = await this.prisma.elderDevice.findFirst({
        where: { familyId },
        orderBy: { lastOnline: 'desc' },
        select: { deviceUuid: true },
      });
      resolvedDeviceId = elderDevice?.deviceUuid;
    }

    if (!resolvedDeviceId) return null;

    const status = await this.redisService.hgetall(`device_status:${resolvedDeviceId}`);
    const socketId = status?.socketId?.trim?.() || '';
    return socketId || null;
  }

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
    await this.redisService.expire(key, 120);

    const membership = await this.prisma.familyMember.findFirst({
      where: { userId: client.userId, role: 'ELDER' },
      select: { familyId: true },
    });

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

  @SubscribeMessage('sos_trigger')
  async handleSosTrigger(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { lat: number; lng: number; battery: number; deviceUuid: string },
  ) {
    const { deviceUuid } = data;
    if (!client.familyId) return;

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
    @MessageBody() data: { sessionId?: string; deviceId: string; elderId?: string; elderName?: string },
  ) {
    if (!client.familyId) return;
    const sessionId = data?.sessionId || randomUUID();

    this.logger.log(
      `[call_guardian] sessionId=${sessionId} initiatorSocket=${client.id} familyId=${client.familyId} deviceId=${data?.deviceId}`,
    );

    this.assistSessions.set(sessionId, {
      sessionId,
      familyId: client.familyId,
      initiatorSocketId: client.id,
      initiatorUserId: client.userId,
      targetSocketId: null,
      targetElderId: data?.elderId,
      status: 'requesting',
    });

    this.emitSessionState(this.assistSessions.get(sessionId)!);

    client.to(`family_${client.familyId}`).emit('call_guardian', {
      ...data,
      sessionId,
      fromSocketId: client.id,
    });

    return { event: 'call_guardian_ack', data: { ok: true, sessionId } };
  }

  @SubscribeMessage('request_assist')
  async handleRequestAssist(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody()
    data: {
      sessionId?: string;
      guardianId?: string;
      guardianName?: string;
      targetSocketId?: string;
      elderId?: string;
      deviceId?: string;
    },
  ) {
    if (!client.familyId) {
      throw new WsException('family_not_bound');
    }

    const sessionId = data?.sessionId || randomUUID();
    const guardianName = data?.guardianName || '守护人';
    const targetSocketId = await this.resolveTargetSocketId({
      familyId: client.familyId,
      elderId: data?.elderId,
      deviceId: data?.deviceId,
      targetSocketId: data?.targetSocketId,
    });

    if (!targetSocketId) {
      client.emit('assist_request_result', {
        ok: false,
        sessionId,
        reason: 'elder_offline',
      });
      return { event: 'assist_request_ack', data: { ok: false, reason: 'elder_offline', sessionId } };
    }

    this.assistSessions.set(sessionId, {
      sessionId,
      familyId: client.familyId,
      initiatorSocketId: client.id,
      targetSocketId,
      initiatorUserId: client.userId,
      targetElderId: data?.elderId,
      status: 'requesting',
    });

    this.emitSessionState(this.assistSessions.get(sessionId)!, undefined, [client.id, targetSocketId]);

    this.server.to(targetSocketId).emit('request_assist', {
      sessionId,
      guardianId: data?.guardianId || client.userId,
      guardianName,
      fromSocketId: client.id,
    });

    client.emit('assist_request_result', {
      ok: true,
      sessionId,
      targetSocketId,
    });

    return { event: 'assist_request_ack', data: { ok: true, sessionId, targetSocketId } };
  }

  @SubscribeMessage('assist_reply')
  handleAssistReply(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { sessionId: string; accept: boolean; targetSocketId?: string },
  ) {
    const { sessionId, accept } = data;
    let session = this.assistSessions.get(sessionId);
    this.logger.log(
      `[assist_reply] sessionId=${sessionId} accept=${accept} replierSocket=${client.id} targetSocketId=${data?.targetSocketId || ''} sessionFound=${!!session}`,
    );

    if (!session || session.status === 'ended' || session.status === 'declined') {
      this.logger.warn(
        `[assist_reply] sessionId=${sessionId} ignored because session is missing or closed`,
      );
      this.server.to(client.id).emit('call_end', {
        sessionId,
        targetId: client.id,
        reason: 'session_closed',
      });
      return;
    }

    if (!session.targetSocketId) {
      session.targetSocketId = client.id;
    }

    session.status = accept ? 'accepted' : 'declined';
    this.assistSessions.set(sessionId, session);
    this.emitSessionState(session, { remoteSocketId: client.id }, [session.initiatorSocketId, client.id]);

    const initiatorSocketId = session.initiatorSocketId;
    const remoteSocketId = client.id;

    this.server.to(initiatorSocketId).emit('assist_reply', {
      sessionId,
      accept,
      fromSocketId: remoteSocketId,
      remoteSocketId,
    });
    this.logger.log(
      `[assist_reply] sessionId=${sessionId} forwarded to initiatorSocket=${initiatorSocketId} remoteSocket=${remoteSocketId}`,
    );

    if (!accept) {
      this.server.to(client.id).emit('call_end', {
        sessionId,
        targetId: client.id,
        reason: 'declined',
      });
      this.server.to(initiatorSocketId).emit('call_end', {
        sessionId,
        targetId: initiatorSocketId,
        reason: 'declined',
      });
      this.assistSessions.delete(sessionId);
    }
  }

  @SubscribeMessage('webrtc_offer')
  handleOffer(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { targetId: string; sessionId: string; sdp: unknown },
  ) {
    this.server.to(data.targetId).emit('webrtc_offer', {
      sessionId: data.sessionId,
      sdp: data.sdp,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('webrtc_answer')
  handleAnswer(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { targetId: string; sessionId: string; sdp: unknown },
  ) {
    this.server.to(data.targetId).emit('webrtc_answer', {
      sessionId: data.sessionId,
      sdp: data.sdp,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('webrtc_ice')
  handleIce(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { targetId: string; sessionId: string; candidate: unknown },
  ) {
    this.server.to(data.targetId).emit('webrtc_ice', {
      sessionId: data.sessionId,
      candidate: data.candidate,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('call_end')
  handleCallEnd(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { sessionId: string; targetId?: string; reason: string },
  ) {
    const session = this.assistSessions.get(data.sessionId);
    this.logger.warn(
      `[call_end] sessionId=${data.sessionId} senderSocket=${client.id} targetId=${data.targetId || ''} reason=${data.reason} sessionFound=${!!session}`,
    );
    const counterpartId = data.targetId || (session
      ? session.initiatorSocketId === client.id
        ? session.targetSocketId
        : session.initiatorSocketId
      : undefined);

    if (session) {
      session.status = 'ended';
      this.assistSessions.set(data.sessionId, session);
      this.emitSessionState(session, { reason: data.reason }, [client.id, counterpartId]);
    }

    if (counterpartId) {
      this.logger.warn(
        `[call_end] sessionId=${data.sessionId} notifying counterpartSocket=${counterpartId}`,
      );
      this.server.to(counterpartId).emit('call_end', {
        sessionId: data.sessionId,
        targetId: counterpartId,
        reason: data.reason,
      });
    } else if (session?.familyId) {
      client.to(`family_${session.familyId}`).emit('call_end', {
        sessionId: data.sessionId,
        reason: data.reason,
      });
    } else if (client.familyId) {
      client.to(`family_${client.familyId}`).emit('call_end', {
        sessionId: data.sessionId,
        reason: data.reason,
      });
    }

    this.server.to(client.id).emit('call_end', {
      sessionId: data.sessionId,
      targetId: client.id,
      reason: data.reason,
    });

    if (session) {
      this.assistSessions.delete(data.sessionId);
    }
  }

  @SubscribeMessage('remote_command')
  handleRemoteCommand(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody()
    data: {
      targetSocketId: string;
      sessionId?: string;
      commandId?: string;
      action: string;
      params: unknown;
      sentAt?: number;
    },
  ) {
    if (data.sessionId) {
      const session = this.assistSessions.get(data.sessionId);
      if (session && session.status !== 'ended' && session.status !== 'declined') {
        const statusChanged = session.status !== 'controlling';
        session.status = 'controlling';
        this.assistSessions.set(data.sessionId, session);
        if (statusChanged) {
          this.emitSessionState(session);
        }
      }
    }

    const { targetSocketId, ...payload } = data;
    this.logger.log(
      `[remote_command] senderSocket=${client.id} targetSocketId=${targetSocketId} sessionId=${data.sessionId || ''} commandId=${data.commandId || ''} action=${data.action}`,
    );
    this.server.to(targetSocketId).emit('remote_command', payload);
  }

  @SubscribeMessage('remote_command_result')
  handleRemoteCommandResult(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody()
    data: {
      targetSocketId: string;
      sessionId?: string;
      commandId?: string;
      action: string;
      success: boolean;
      sentAt?: number;
      handledAt?: number;
      completedAt?: number;
      error?: string;
      detail?: string;
    },
  ) {
    const { targetSocketId, ...payload } = data;
    this.logger.log(
      `[remote_command_result] senderSocket=${client.id} targetSocketId=${targetSocketId} sessionId=${data.sessionId || ''} commandId=${data.commandId || ''} action=${data.action} success=${data.success}`,
    );
    this.server.to(targetSocketId).emit('remote_command_result', payload);
  }

  @SubscribeMessage('screen_frame_request')
  handleScreenFrameRequest(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { sessionId: string; targetSocketId: string },
  ) {
    this.logger.log(
      `[screen_frame_request] senderSocket=${client.id} targetSocketId=${data.targetSocketId} sessionId=${data.sessionId}`,
    );
    this.server.to(data.targetSocketId).emit('screen_frame_request', {
      sessionId: data.sessionId,
      requesterSocketId: client.id,
    });
  }

  @SubscribeMessage('screen_frame_result')
  handleScreenFrameResult(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody()
    data: {
      sessionId: string;
      targetSocketId: string;
      success: boolean;
      frameData?: string;
      error?: string;
      detail?: string;
    },
  ) {
    this.logger.log(
      `[screen_frame_result] senderSocket=${client.id} targetSocketId=${data.targetSocketId} sessionId=${data.sessionId} success=${data.success}`,
    );
    const { targetSocketId, ...payload } = data;
    this.server.to(targetSocketId).emit('screen_frame_result', payload);
  }

  @SubscribeMessage('current_remote_config_response')
  handleCurrentRemoteConfigResponse(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { requestId?: string; config?: any },
  ) {
    if (!data?.requestId) {
      return;
    }

    const pendingRequest = this.currentConfigRequests.get(data.requestId);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.currentConfigRequests.delete(data.requestId);
    this.logger.log(
      `[current_remote_config_response] socket=${client.id} requestId=${data.requestId}`,
    );
    pendingRequest.resolve(data.config ?? null);
  }

  async sendBindSuccess(deviceUuid: string, familyId: string) {
    const key = `device_status:${deviceUuid}`;
    const socketId = await this.redisService.hget(key, 'socketId');
    if (socketId) {
      this.server.to(socketId).emit('bind_success', { familyId });
    }
  }
}
