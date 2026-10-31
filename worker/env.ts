/**
 * Bindings for the lite Worker. Secrets stay in `wrangler secret` and are
 * never written into config. GOOGLE_* and BETTER_AUTH_SECRET already exist
 * on the live `cuentix` worker; staging `cuentix-lite` does not receive them
 * automatically.
 */
export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<unknown[]>;
}

export interface Env {
  DB: D1Database;
  RECEIPTS: {
    put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<unknown>;
    get(key: string): Promise<{
      body: ReadableStream;
      httpMetadata?: { contentType?: string };
    } | null>;
  };
  AI: {
    toMarkdown(documents: unknown, options?: unknown): Promise<unknown>;
  };
  ASSETS: { fetch(input: Request): Promise<Response> };
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Reused only as an HMAC key for the OAuth state cookie. Never log it. */
  BETTER_AUTH_SECRET?: string;
  ALLOWED_EMAILS?: string;
  /** Roommate payee tokens ("ANA+PEREZ,ANITA"). Set as a Worker secret/var, never commit. */
  REINTEGRO_PAYEES?: string;
  AUTH_URL?: string;
  OPENAI_API_KEY?: string;
  /** wrangler secret. Never put this in wrangler.jsonc or logs. */
  CUENTIX_SYNC_SECRET?: string;
  /** Override in tests. Prod sets it in wrangler vars. */
  SERPIX_SYNC_URL?: string;
}

/** Subset of the Workers execution context. Tests pass a fake. */
export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}
