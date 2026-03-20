import { IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import { trackerEvents } from '../services/tracker.js';
import type { PingData } from '../services/tracker.js';
import { PrismaClient } from '@prisma/client';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable is missing in production!');
}
const ACTUAL_SECRET = JWT_SECRET || 'dev-secret-ignore-this';

interface AuthClient {
  ws: WebSocket;
  userId: string;
  role: 'Admin' | 'Customer';
  imeis: Set<string>;
}

let wss: WebSocketServer | null = null;
const clients = new Set<AuthClient>();

export function startWsServer(httpServer: Server) {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', async (ws, req) => {
    const auth = await authenticate(ws, req);
    if (!auth) return;

    clients.add(auth);
    logger.info({ userId: auth.userId }, 'WS client connected');

    ws.on('close', () => {
      clients.delete(auth);
      logger.info({ userId: auth.userId }, 'WS client disconnected');
    });
  });

  trackerEvents.on('tracker:live', (data: PingData) => broadcast('tracker:live', data));
  trackerEvents.on('tracker:unknown', (data: any) => broadcastAdmins('tracker:unknown', data));
}

async function authenticate(ws: WebSocket, req: IncomingMessage): Promise<AuthClient | null> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Token missing');
    return null;
  }

  try {
    const decoded = jwt.verify(token, ACTUAL_SECRET) as any;
    const imeis = new Set<string>();

    if (decoded.role === 'Customer') {
      const devices = await prisma.device.findMany({ where: { customer_id: decoded.id }, select: { imei: true } });
      devices.forEach((d: { imei: string }) => imeis.add(d.imei));
    }

    return { ws, userId: decoded.id, role: decoded.role, imeis };
  } catch (err) {
    ws.close(4001, 'Invalid token');
    return null;
  }
}

function broadcast(event: string, data: any) {
  const payload = JSON.stringify({ event, data });
  let count = 0;
  clients.forEach(client => {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (client.role === 'Admin' || (client.role === 'Customer' && client.imeis.has(data.imei))) {
        client.ws.send(payload);
        count++;
      }
    }
  });
  logger.info({ event, count }, `Broadcasted to ${count} clients`);
}

function broadcastAdmins(event: string, data: any) {
  const payload = JSON.stringify({ event, data });
  clients.forEach(client => {
    if (client.ws.readyState === WebSocket.OPEN && client.role === 'Admin') {
      client.ws.send(payload);
    }
  });
}

export async function stopWsServer() {
  wss?.close();
}
