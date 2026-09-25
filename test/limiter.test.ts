import { describe, expect, it } from "vitest";
import { LocalGcraLimiter, timing } from "../src/limiter";

describe("GCRA timing", () => {
  it("converts rate and burst into interval and burst delay", () => {
    expect(timing({ ratePerSecond: 100, burst: 3 })).toEqual({ emissionIntervalMs: 10, burstDelayMs: 20 });
  });
  it("rejects unsupported settings", () => {
    expect(() => timing({ ratePerSecond: 0, burst: 1 })).toThrow();
  });
});

describe("LocalGcraLimiter", () => {
  it("allows a burst and reports exact retry delay without advancing on rejection", () => {
    let now = 0;
    const limiter = new LocalGcraLimiter({ ratePerSecond: 100, burst: 3 }, () => now);
    expect(limiter.admit()).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.admit()).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.admit()).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.admit()).toEqual({ allowed: false, retryAfterMs: 10 });
    now = 9;
    expect(limiter.admit()).toEqual({ allowed: false, retryAfterMs: 1 });
    now = 10;
    expect(limiter.admit()).toEqual({ allowed: true, retryAfterMs: 0 });
  });
});
