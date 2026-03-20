import { PrismaClient } from '@prisma/client';
import EventEmitter from 'events';
import NodeCache from 'node-cache';
import pino from 'pino';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

const prisma = new PrismaClient();
export const trackerEvents = new EventEmitter();

const imeiCache = new NodeCache({ stdTTL: 300 });
const unknownImeiThrottle = new NodeCache({ stdTTL: 5 });

let logBuffer: PingData[] = [];
const BATCH_SIZE = 100;
const FLUSH_INTERVAL = 5000;
let flushTimer: NodeJS.Timeout | null = null;

export interface PingData {
  imei: string;
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean;
  timestamp: Date;
}

export async function handlePing(data: PingData) {
  const isRegistered = await checkImei(data.imei);

  if (isRegistered) {
    trackerEvents.emit('tracker:live', data);
    bufferLog(data);
  } else if (!unknownImeiThrottle.has(data.imei)) {
    unknownImeiThrottle.set(data.imei, true);
    trackerEvents.emit('tracker:unknown', { imei: data.imei, status: 'UNREGISTERED_DEVICE' });
    logger.warn({ imei: data.imei }, 'Unregistered IMEI detected');
  }
}

async function checkImei(imei: string): Promise<boolean> {
  const cached = imeiCache.get<boolean>(imei);
  if (cached !== undefined) return cached;

  const device = await prisma.device.findUnique({ where: { imei }, select: { imei: true } });
  const exists = !!device;
  imeiCache.set(imei, exists);
  return exists;
}

function bufferLog(data: PingData) {
  logBuffer.push(data);
  if (logBuffer.length >= BATCH_SIZE) flushLogs();
}

export async function flushLogs() {
  if (logBuffer.length === 0) return;
  const batch = [...logBuffer];
  logBuffer = [];

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
    logger.info({ count: batch.length }, 'Logs saved to DB');
  } catch (error) {
    logger.error({ error }, 'Failed to save logs, re-buffering...');
    // Re-buffer for retry in the next cycle (Tier 2 requirement)
    logBuffer = [...batch, ...logBuffer];
  }
}

export function startTracker() {
  flushTimer = setInterval(flushLogs, FLUSH_INTERVAL);
}

export async function getHealth() {
  return {
    pending_count: logBuffer.length,
    uptime_seconds: Math.floor(process.uptime()),
  };
}

export async function stopTracker() {
  if (flushTimer) clearInterval(flushTimer);
  await flushLogs();
  await prisma.$disconnect();
}
