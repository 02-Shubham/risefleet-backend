import express from 'express';
import http from 'node:http';
import pino from 'pino';
import * as dotenv from 'dotenv';
import { startTcpServer, stopTcpServer } from './tcp/server.js';
import { startWsServer, stopWsServer } from './websocket/server.js';
import { startTracker, stopTracker } from './services/tracker.js';
import { setupApi } from './api/server.js';

dotenv.config();

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;
const TCP_PORT = Number(process.env.TCP_PORT) || 5000;

async function bootstrap() {
  // 1. Start core tracker (batch timer)
  startTracker();

  // 2. Start servers
  startTcpServer(TCP_PORT);
  startWsServer(server);
  setupApi(app);

  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'HTTP/WS Server started');
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    await stopTcpServer();
    await stopWsServer();
    server.close(async () => {
      await stopTracker();
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch(err => {
  logger.error({ err }, 'Bootstrap failed');
  process.exit(1);
});
