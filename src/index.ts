import express from 'express';
import http from 'http';
import pino from 'pino';
import * as dotenv from 'dotenv';
import { TcpServer } from './tcp/server.js';
import { WsServer } from './websocket/server.js';
import { trackerService } from './services/tracker.js';
import { setupApi } from './api/server.js';

dotenv.config();

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;
const TCP_PORT = Number(process.env.TCP_PORT) || 5000;

// Setup Servers
const tcpServer = new TcpServer(TCP_PORT);
const wsServer = new WsServer(server);
setupApi(app);

async function bootstrap() {
  // Start TCP Server
  tcpServer.start();

  // Start HTTP & WebSocket Server
  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'HTTP & WebSocket Server started');
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    
    // Stop accepting new connections
    await tcpServer.shutdown();
    await wsServer.shutdown();
    
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Flush pending DB logs
      await trackerService.shutdown();
      
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit if not closed in 10s
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to bootstrap application');
  process.exit(1);
});
