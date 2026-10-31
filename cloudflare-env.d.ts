// Bindings the Worker receives. OpenNext copies string values onto process.env
// at the start of each request when nodejs_compat is enabled. R2 stays a binding.
interface ReceiptsBucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    writeHttpMetadata?: (headers: Headers) => void;
  } | null>;
  delete(key: string): Promise<void>;
}

interface AiMarkdownDocument {
  name: string;
  blob: Blob;
}

interface AiMarkdownResult {
  name: string;
  mimeType?: string;
  format: "markdown" | "text" | "error" | string;
  tokens?: number;
  data: string;
}

interface AiBinding {
  toMarkdown(
    documents: AiMarkdownDocument | AiMarkdownDocument[],
    options?: { conversionOptions?: { output?: { format?: "text" | "markdown" } } },
  ): Promise<AiMarkdownResult | AiMarkdownResult[]>;
}

/**
 * D1 binding. Typed loosely so app code does not depend on a global
 * `D1Database` (Workers types are not installed). Drizzle accepts this
 * via a cast at the `drizzle()` call.
 */
interface D1Binding {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
    };
  };
  batch<T = unknown>(statements: unknown[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
}

declare global {
  interface CloudflareEnv {
    RECEIPTS?: ReceiptsBucket;
    DB?: D1Binding;
    AI?: AiBinding;
    NEXT_PUBLIC_APP_URL?: string;
    AUTH_URL?: string;
    BETTER_AUTH_URL?: string;
    BETTER_AUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OPENAI_API_KEY?: string;
    AGENT_API_TOKEN?: string;
    POLAR_ACCESS_TOKEN?: string;
    POLAR_PRODUCT_ID?: string;
    POLAR_WEBHOOK_SECRET?: string;
    POLAR_SERVER?: string;
    ALLOWED_EMAILS?: string;
  }
}

export {};
