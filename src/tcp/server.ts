import * as net from 'net';
import pino from 'pino';
import { trackerService } from '../services/tracker.js';
import type { PingData } from '../services/tracker.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

export class TcpServer {
  private server: net.Server;
  private readonly port: number;

  constructor(port: number = 5000) {
    this.port = port;
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  start() {
    this.server.listen(this.port, () => {
      logger.info({ port: this.port }, 'TCP Ingest Server started');
    });

    this.server.on('error', (err) => {
      logger.error({ err }, 'TCP Server Error');
    });
  }

  private handleConnection(socket: net.Socket) {
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info({ remoteAddress }, 'New TCP device connection');

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const rawPacket = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        
        if (rawPacket) {
          this.processPacket(rawPacket, socket);
        }
      }
    });

    socket.on('end', () => {
      logger.info({ remoteAddress }, 'TCP device disconnected');
    });

    socket.on('error', (err) => {
      logger.error({ remoteAddress, err }, 'Socket Error');
    });
  }

  private processPacket(rawPacket: string, socket: net.Socket) {
    const parts = rawPacket.split(',');

    // Protocol: PING,<imei>,<lat>,<lng>,<speed>,<ignition>
    if (parts.length !== 6 || parts[0] !== 'PING') {
      logger.warn({ rawPacket }, 'Malformed packet dropped');
      return;
    }

    const [_, imei, latStr, lngStr, speedStr, ignitionStr] = parts;

    // Validate all parts exist
    if (!imei || !latStr || !lngStr || !speedStr || !ignitionStr) {
      logger.warn({ rawPacket }, 'Incomplete packet dropped');
      return;
    }

    if (imei.length !== 15) {
      logger.warn({ rawPacket, imei }, 'Invalid IMEI length dropped');
      return;
    }

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    const speed = parseFloat(speedStr);
    const ignition = ignitionStr === '1';

    if (isNaN(lat) || isNaN(lng) || isNaN(speed)) {
      logger.warn({ rawPacket }, 'Invalid numeric fields dropped');
      return;
    }

    const ping: PingData = {
      imei,
      lat,
      lng,
      speed,
      ignition,
      timestamp: new Date()
    };

    // Pass to central tracker service
    trackerService.handlePing(ping);
  }

  async shutdown() {
    return new Promise<void>((resolve) => {
      logger.info('Shutting down TCP server...');
      this.server.close(() => {
        logger.info('TCP server closed');
        resolve();
      });
    });
  }
}
