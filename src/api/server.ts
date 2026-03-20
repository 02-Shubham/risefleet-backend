import express from 'express';
import { PrismaClient, UserRole } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import pino from 'pino';
import { trackerService } from '../services/tracker.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-123';

export const setupApi = (app: express.Express) => {
  app.use(express.json());

  // 1. POST /auth/token - Issue test JWT
  app.post('/auth/token', async (req, res) => {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
        expiresIn: '24h',
      });

      res.json({ token });
    } catch (err) {
      logger.error({ err }, 'Token generation failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Middleware for Auth
  const authenticate = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // 2. GET /devices - Admin Only
  app.get('/devices', authenticate, async (req: any, res) => {
    if (req.user.role !== UserRole.Admin) {
      return res.status(403).json({ error: 'Admin only' });
    }

    const devices = await prisma.device.findMany({
      include: { customer: { select: { email: true } } }
    });
    res.json(devices);
  });

  // 3. GET /devices/:imei/history - Admin or own Customer
  app.get('/devices/:imei/history', authenticate, async (req: any, res) => {
    const { imei } = req.params;

    const device = await prisma.device.findUnique({
      where: { imei },
      select: { customer_id: true }
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Role check
    if (req.user.role !== UserRole.Admin && device.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to device history' });
    }

    const logs = await prisma.locationLog.findMany({
      where: { imei },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    res.json(logs);
  });

  // 4. GET /health - Returns metrics
  app.get('/health', async (req, res) => {
    const health = await trackerService.getHealth();
    res.json({
      status: 'UP',
      ...health
    });
  });
};
