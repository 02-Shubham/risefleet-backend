import { IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as jwt from 'jsonwebtoken';
import pino from 'pino';
import { trackerService } from '../services/tracker.js';
import type { PingData } from '../services/tracker.js';
import { PrismaClient, UserRole } from '@prisma/client';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-123';

interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
  role: UserRole;
  assignedImeis: Set<string>;
}

export class WsServer {
  private wss: WebSocketServer;
  private clients: Set<AuthenticatedClient> = new Set();

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer });
    this.init();
  }

  private init() {
    this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      const auth = await this.authenticate(ws, req);
      if (!auth) return;

      this.clients.add(auth);
      logger.info({ userId: auth.userId, role: auth.role }, 'WebSocket client connected');

      ws.on('close', () => {
        this.clients.delete(auth);
        logger.info({ userId: auth.userId }, 'WebSocket client disconnected');
      });
    });

    // Listen for tracker events
    trackerService.on('tracker:live', (data: PingData) => {
      this.broadcast('tracker:live', data);
    });

    trackerService.on('tracker:unknown', (data: any) => {
      this.broadcastToAdmins('tracker:unknown', data);
    });
  }

  private async authenticate(ws: WebSocket, req: IncomingMessage): Promise<AuthenticatedClient | null> {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Token missing');
      return null;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.id;
      const role = decoded.role as UserRole;

      // Fetch assigned IMEIs for Customer
      const assignedImeis = new Set<string>();
      if (role === UserRole.Customer) {
        const devices = await prisma.device.findMany({
          where: { customer_id: userId },
          select: { imei: true }
        });
        devices.forEach((d: { imei: string }) => assignedImeis.add(d.imei));
      }

      return { ws, userId, role, assignedImeis };
    } catch (err) {
      ws.close(1008, 'Invalid token');
      return null;
    }
  }

  private broadcast(event: string, data: any) {
    const payload = JSON.stringify({ event, data });

    this.clients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        // Data Isolation Rules
        if (client.role === UserRole.Admin) {
          client.ws.send(payload);
        } else if (client.role === UserRole.Customer && event === 'tracker:live') {
          // Only if this IMEI is assigned to this customer
          if (client.assignedImeis.has(data.imei)) {
            client.ws.send(payload);
          }
        }
      }
    });
  }

  private broadcastToAdmins(event: string, data: any) {
    const payload = JSON.stringify({ event, data });

    this.clients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN && client.role === UserRole.Admin) {
        client.ws.send(payload);
      }
    });
  }

  async shutdown() {
    logger.info('Shutting down WebSocket server...');
    this.wss.close();
  }
}
