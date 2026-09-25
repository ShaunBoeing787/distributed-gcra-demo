import express from "express";
import Redis from "ioredis";
import { CoordinatorUnavailableError, DistributedGcraLimiter } from "./limiter";

const app = express();
app.use(express.json());
const port = Number(process.env.PORT ?? 3000);
const replica = process.env.REPLICA_NAME ?? `replica-${process.pid}`;
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
  lazyConnect: true,
});
const limiter = new DistributedGcraLimiter(redis, {
  ratePerSecond: Number(process.env.RATE_PER_SECOND ?? 5),
  burst: Number(process.env.BURST ?? 3),
}, "demo:{shared-api-budget}:request");

app.get("/health", (_req, res) => res.json({ ok: true, replica }));
app.get("/limited", async (_req, res) => {
  try {
    const decision = await limiter.admit();
    if (!decision.allowed) {
      return res.status(429)
        .set("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)))
        .json({ error: "rate_limit_exceeded", retryAfterMs: decision.retryAfterMs, replica });
    }
    return res.json({ ok: true, replica, admittedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof CoordinatorUnavailableError) {
      return res.status(503).json({ error: "coordinator_unavailable", message: "Admission could not be confirmed; request was not run.", replica });
    }
    return res.status(500).json({ error: "internal_error", replica });
  }
});

async function start() {
  try {
    await redis.connect();
    app.listen(port, () => console.log(`${replica} listening on :${port}`));
  } catch (error) {
    console.error("Redis connection failed; server will not accept requests", error);
    process.exit(1);
  }
}

void start();
