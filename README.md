## 🚀 Architecture Overview

```text
IoT Device (TCP:5000) ──► TCP Server (Net) ──► trackerEvents (EventEmitter) ──► WS Server (ws) ──► Dashboard
                               │                                                 
                               └──► Batch Buffer (Array) ──► 5s Timer ──► PostgreSQL (Prisma)
```

### Approach: TCP to DB
We use an **Event-Driven, Buffered Batching** approach:
- **Low Latency**: WebSocket updates are decoupled from DB persistence. The `trackerEvents` hub ensures the dashboard sees data *milliseconds* after ingest.
- **Write Efficiency**: We use `createMany` every 5 seconds or 100 logs. This protects the DB from high-frequency single-row inserts which would crash performance under stress.

## 📊 Database Index Strategy
- **`imei`**: B-Tree index for O(log N) lookups of device history.
- **`timestamp`**: Index for fast sorting of time-series data without memory-intensive sorting in Node.js.

## ⚠️ Known Limitations & Improvements
- **In-Memory Buffer**: If the server crashes, up to 5 seconds of logs could be lost. **Improvement**: Add a Redis-backed Write-Ahead Log (WAL) or persistent queue (RabbitMQ) for mission-critical reliability.
- **Horizontal Scaling**: Currently uses a local `EventEmitter`. **Improvement**: Use Redis Pub/Sub to sync events across multiple instances of the backend.
- **Security**: Basic JWT is used. **Improvement**: Implement Refresh Tokens and IP-based rate limiting for the TCP server to prevent DDoS.

## ⚙️ Local Setup
1. `make setup` - Install dependencies.
2. `make up` - Start PostgreSQL via Docker.
3. `make push-db` - Synchronize Prisma schema.
4. `make seed` - Create test users and devices.
5. `make dev` - Start the full server stack.

## 🚦 .env Variables
See `.env.example` for the full list of required variables, including `DATABASE_URL` and `JWT_SECRET`.
