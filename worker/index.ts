/** Cloudflare Worker entry for SayPay (vinext app router + scheduled jobs). */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  // Every 15 minutes: mark due scheduled payments and write activity rows.
  // Money is never moved here — the user still confirms in Nimiq Pay.
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        // Bind DB for getDb() via cloudflare:workers when routes run; for the
        // scheduled path call the mark-due helper with an explicit env inject.
        const { markDueSchedules } = await import("../app/api/schedules/mark-due");
        // Ensure drizzle can see env.DB — vinext apps use cloudflare:workers env.
        // If import path resolves, DB binding is already ambient in the worker.
        const result = await markDueSchedules();
        console.log("[saypay-cron] marked due schedules", result);
      } catch (error) {
        console.error("[saypay-cron] failed", error);
      }
    })());
  },
};

export default worker;
