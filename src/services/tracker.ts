import { PrismaClient } from '@prisma/client';
import EventEmitter from 'events';
import NodeCache from 'node-cache';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const prisma = new PrismaClient();

// In-memory cache for registered IMEIs to avoid DB lookups on ogni ping
const imeiCache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache
const unknownImeiThrottle = new NodeCache({ stdTTL: 5 }); // 5 seconds throttle

export interface PingData {
  imei: string;
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean;
  timestamp: Date;
}

export class TrackerService extends EventEmitter {
  private logBuffer: PingData[] = [];
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startFlushTimer();
  }

  /**
   * Main entry point for a new PING from TCP server
   */
  async handlePing(data: PingData) {
    const isRegistered = await this.isImeiRegistered(data.imei);

    if (isRegistered) {
      // 1. Broadcast to WS
      this.emit('tracker:live', data);

      // 2. Buffer for DB
      this.bufferLocationLog(data);
    } else {
      // 3. Handle unknown IMEI with throttling
      if (!unknownImeiThrottle.has(data.imei)) {
        unknownImeiThrottle.set(data.imei, true);
        this.emit('tracker:unknown', {
          imei: data.imei,
          status: 'UNREGISTERED_DEVICE'
        });
        logger.warn({ imei: data.imei }, 'Unregistered IMEI detected (throttled)');
      }
    }
  }

  private async isImeiRegistered(imei: string): Promise<boolean> {
    const cached = imeiCache.get<boolean>(imei);
    if (cached !== undefined) return cached;

    const device = await prisma.device.findUnique({
      where: { imei },
      select: { imei: true }
    });

    const exists = !!device;
    imeiCache.set(imei, exists);
    return exists;
  }

  private bufferLocationLog(data: PingData) {
    this.logBuffer.push(data);

    if (this.logBuffer.length >= this.BATCH_SIZE) {
      this.flushLogs();
    }
  }

  private startFlushTimer() {
    this.flushTimer = setInterval(() => this.flushLogs(), this.FLUSH_INTERVAL);
  }

  async flushLogs() {
    if (this.logBuffer.length === 0) return;

    const batch = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await prisma.locationLog.createMany({
        data: batch.map(log => ({
          imei: log.imei,
          lat: log.lat,
          lng: log.lng,
          speed: log.speed,
          ignition: log.ignition,
          timestamp: log.timestamp
        }))
      });
      logger.info({ count: batch.length }, 'Batched location logs saved to DB');
    } catch (error) {
      logger.error({ error, count: batch.length }, 'Failed to save batched location logs');
      // In a real system, we might want to retry or store in a DLQ
    }
  }

  async getHealth() {
    return {
      pending_count: this.logBuffer.length,
      uptime_seconds: Math.floor(process.uptime()),
    };
  }

  async shutdown() {
    logger.info('Shutting down TrackerService, flushing logs...');
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushLogs();
    await prisma.$disconnect();
  }
}

export const trackerService = new TrackerService();
