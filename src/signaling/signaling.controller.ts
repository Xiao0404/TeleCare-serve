import { Controller, Get } from '@nestjs/common';

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type IceTransportPolicy = 'all' | 'relay';

function normalizeIceServers(value: unknown): IceServer[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const servers: IceServer[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const server = item as Record<string, unknown>;
    const urls = server.urls;
    if (
      !urls ||
      !(
        typeof urls === 'string' ||
        (Array.isArray(urls) && urls.every((entry) => typeof entry === 'string'))
      )
    ) {
      return;
    }

    servers.push({
      urls,
      username: typeof server.username === 'string' ? server.username : undefined,
      credential: typeof server.credential === 'string' ? server.credential : undefined,
    });
  });

  return servers;
}

function parseIceServerList(raw: string | undefined) {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildWebRtcIceServers(): IceServer[] {
  const json = process.env.WEBRTC_ICE_SERVERS_JSON?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json);
      const normalized = normalizeIceServers(parsed);
      if (normalized.length) {
        return normalized;
      }
    } catch (_) {
      // Fall through to env-based construction.
    }
  }

  const stunUrls = parseIceServerList(process.env.WEBRTC_STUN_URLS);
  const turnUrls = parseIceServerList(process.env.WEBRTC_TURN_URLS);
  const servers: IceServer[] = [];

  if (stunUrls.length) {
    servers.push({
      urls: stunUrls.length === 1 ? stunUrls[0] : stunUrls,
    });
  }

  if (turnUrls.length) {
    servers.push({
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
      username: process.env.WEBRTC_TURN_USERNAME || undefined,
      credential: process.env.WEBRTC_TURN_CREDENTIAL || undefined,
    });
  }

  if (!servers.length) {
    servers.push({ urls: 'stun:stun.l.google.com:19302' });
  }

  return servers;
}

function buildIceTransportPolicy(): IceTransportPolicy {
  return process.env.WEBRTC_ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all';
}

@Controller('signaling')
export class SignalingController {
  @Get('webrtc-config')
  getWebRtcConfiguration() {
    return {
      iceServers: buildWebRtcIceServers(),
      iceTransportPolicy: buildIceTransportPolicy(),
    };
  }
}
