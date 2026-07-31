/**
 * Minimal Cloudflare typings for this app.
 *
 * `wrangler types` is deliberately not used here: its generated file declares
 * the HTMLRewriter `Element` interface globally, whose `append(content: string
 * | ReadableStream | Response)` collides with the DOM `ParentNode.append` that
 * the client components rely on. This app compiles browser and Worker code in
 * one program, so only the bindings actually used are declared.
 */

type Fetcher = { fetch(request: Request): Promise<Response> };

type D1Database = import("drizzle-orm/d1").AnyD1Database;

declare module "cloudflare:workers" {
  export const env: {
    /** D1 binding declared in wrangler.jsonc. */
    DB?: D1Database;
    /** Overrides the Nimiq JSON-RPC endpoint; see app/api/_lib/nimiq-rpc.ts. */
    NIMIQ_RPC_URL?: string;
    [binding: string]: unknown;
  };
}
