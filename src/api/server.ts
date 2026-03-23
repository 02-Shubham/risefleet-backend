import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import { getHealth } from '../services/tracker.js';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable is missing in production!');
}
const ACTUAL_SECRET = JWT_SECRET || 'dev-secret-ignore-this';

export const setupApi = (app: express.Express) => {
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({ 
      message: '👑 RiseFleet Tracking API is Online',
      status: 'Ready',
      endpoints: ['/health', '/auth/token', '/devices']
    });
  });

  app.post('/auth/token', async (req, res) => {
    const { email } = req.body;
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, ACTUAL_SECRET, { expiresIn: '24h' });
      res.json({ token });
    } catch (err: any) {
      logger.error({ err }, 'Auth failed');
      res.status(500).json({ error: 'Auth failed', details: err.message });
    }
  });

  const authenticate = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
      req.user = jwt.verify(authHeader.split(' ')[1]!, ACTUAL_SECRET) as any;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  app.get('/devices', authenticate, async (req: any, res) => {
    if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    const devices = await prisma.device.findMany({ include: { customer: { select: { email: true } } } });
    res.json(devices);
  });

  app.get('/devices/:imei/history', authenticate, async (req: any, res) => {
    const { imei } = req.params;
    const device = await prisma.device.findUnique({ where: { imei } });
    if (!device) return res.status(404).json({ error: 'Device not found' });

    if (req.user.role !== 'Admin' && device.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const logs = await prisma.locationLog.findMany({ where: { imei }, orderBy: { timestamp: 'desc' }, take: 100 });
    res.json(logs);
  });

  app.get('/health', async (req, res) => {
    res.json({ status: 'UP', ...(await getHealth()) });
  });
};
