import * as net from 'node:net';
import pino from 'pino';
import { handlePing } from '../services/tracker.js';
import type { PingData } from '../services/tracker.js';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

let server: net.Server | null = null;

export function startTcpServer(port: number = 5050) {
  server = net.createServer((socket) => {
    logger.info({ remote: socket.remoteAddress }, 'New TCP connection');
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (raw) parseAndProcess(raw);
      }
    });

    socket.on('error', (err) => logger.error({ err }, 'Socket Error'));
  });

  server.listen(port, () => logger.info({ port }, 'TCP Ingest Server started'));
}

function parseAndProcess(rawPacket: string) {
  const parts = rawPacket.split(',');

  if (parts.length !== 6 || parts[0] !== 'PING') {
    logger.warn({ rawPacket }, 'Malformed packet');
    return;
  }

  const [_, imei, latStr, lngStr, speedStr, ignitionStr] = parts;
  if (!imei || imei.length !== 15 || !latStr || !lngStr || !speedStr || !ignitionStr) {
    logger.warn({ rawPacket }, 'Invalid packet data');
    return;
  }

  const ping: PingData = {
    imei,
    lat: parseFloat(latStr),
    lng: parseFloat(lngStr),
    speed: parseFloat(speedStr),
    ignition: ignitionStr === '1',
    timestamp: new Date()
  };

  handlePing(ping);
}

export async function stopTcpServer() {
  if (!server) return;
  return new Promise<void>((resolve) => {
    server?.close(() => {
      logger.info('TCP server closed');
      resolve();
    });
  });
}
