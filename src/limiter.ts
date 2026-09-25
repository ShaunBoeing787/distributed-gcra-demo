import Redis from "ioredis";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Decision = { allowed: true; retryAfterMs: 0 } | { allowed: false; retryAfterMs: number };

export interface GcraSettings {
  ratePerSecond: number;
  burst: number;
}

export function timing(settings: GcraSettings): { emissionIntervalMs: number; burstDelayMs: number } {
  const { ratePerSecond, burst } = settings;
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0 || ratePerSecond > 1000) {
    throw new Error("ratePerSecond must be greater than 0 and at most 1000");
  }
  if (!Number.isInteger(burst) || burst < 1 || burst > 10000) {
    throw new Error("burst must be an integer between 1 and 10000");
  }
  const emissionIntervalMs = Math.round(1000 / ratePerSecond);
  const burstDelayMs = (burst - 1) * emissionIntervalMs;
  if (!Number.isSafeInteger(emissionIntervalMs) || emissionIntervalMs < 1 || !Number.isSafeInteger(burstDelayMs)) {
    throw new Error("settings produce unsafe timing values");
  }
  return { emissionIntervalMs, burstDelayMs };
}

// Keep the script as a plainly visible project file; npm scripts run from the project root.
const script = readFileSync(join(process.cwd(), "src", "gcra.lua"), "utf8");

export class DistributedGcraLimiter {
  private readonly interval: number;
  private readonly burstDelay: number;

  constructor(
    private readonly redis: Redis,
    settings: GcraSettings,
    private readonly key: string,
  ) {
    const t = timing(settings);
    this.interval = t.emissionIntervalMs;
    this.burstDelay = t.burstDelayMs;
  }

  async admit(): Promise<Decision> {
    try {
      const reply = await this.redis.eval(script, 1, this.key, this.interval, this.burstDelay) as [number, number];
      if (!Array.isArray(reply) || reply.length !== 2 || (Number(reply[0]) !== 0 && Number(reply[0]) !== 1)) {
        throw new Error("Redis returned an invalid GCRA decision");
      }
      return Number(reply[0]) === 1
        ? { allowed: true, retryAfterMs: 0 }
        : { allowed: false, retryAfterMs: Math.max(0, Number(reply[1])) };
    } catch (cause) {
      // Fail closed: no downstream work runs unless Redis confirms admission.
      throw new CoordinatorUnavailableError("Could not confirm rate-limit admission", { cause });
    }
  }
}

export class CoordinatorUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CoordinatorUnavailableError";
  }
}

/** Local counterpart, useful for comparing per-process behavior. */
export class LocalGcraLimiter {
  private tat = 0;
  private readonly interval: number;
  private readonly burstDelay: number;

  constructor(settings: GcraSettings, private readonly now: () => number = Date.now) {
    const t = timing(settings);
    this.interval = t.emissionIntervalMs;
    this.burstDelay = t.burstDelayMs;
  }

  admit(): Decision {
    const current = this.now();
    const anchored = Math.max(this.tat, current);
    if (anchored - current > this.burstDelay) {
      return { allowed: false, retryAfterMs: anchored - this.burstDelay - current };
    }
    this.tat = anchored + this.interval;
    return { allowed: true, retryAfterMs: 0 };
  }
}
