/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Tracks request timestamps per key (typically IP address) and rejects
 * requests that exceed the configured limit within the window.
 *
 * NOTE: This is a per-process limiter. For horizontally scaled deployments,
 * replace with a Redis-backed solution (e.g., @upstash/ratelimit).
 */

interface RateLimitEntry {
  /** Sorted array of request timestamps (ms) within the current window */
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Periodically purge stale entries to prevent memory leaks.
// Runs every 60 seconds; only touches entries past their window.
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(windowMs: number): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      // Remove expired timestamps
      const cutoff = now - windowMs;
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the process to exit without waiting for the timer
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Unix timestamp (ms) when the window resets */
  resetMs: number;
}

/**
 * Check if a request should be rate-limited.
 *
 * @param key - Unique identifier for the client (e.g., IP address, user ID)
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Window duration in milliseconds (default: 60_000 = 1 min)
 * @returns RateLimitResult with the decision and headers-friendly metadata
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number = 60_000,
): RateLimitResult {
  // Coerce empty keys to a sentinel so we never store blank entries
  const normalizedKey = key || "unknown";
  const now = Date.now();

  startCleanup(windowMs);

  let entry = store.get(normalizedKey);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(normalizedKey, entry);
  }

  // Prune timestamps outside the window
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    // Rate limited — return the window end time from the oldest timestamp
    const oldest = entry.timestamps[0]!;
    return {
      allowed: false,
      remaining: 0,
      resetMs: oldest + windowMs,
    };
  }

  // Record this request
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: limit - entry.timestamps.length,
    resetMs: now + windowMs,
  };
}

/**
 * Build a standard set of rate-limit headers for the response.
 */
export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  return {
    "X-RateLimit-Limit": limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": Math.ceil(result.resetMs / 1000).toString(),
  };
}

/**
 * Get the client IP from a NextRequest, respecting common proxy headers.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list: "client, proxy1, proxy2"
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
}
