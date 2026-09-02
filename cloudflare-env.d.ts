/** Minimal Worker bindings used by the optional starter infrastructure. */
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
}

interface PasswordResetDeliveryBindings {
  BREVO_API_KEY?: string;
  BREVO_FROM_EMAIL?: string;
  BREVO_FROM_NAME?: string;
}

declare namespace NodeJS {
  interface ProcessEnv {
    BREVO_API_KEY?: string;
    BREVO_FROM_EMAIL?: string;
    BREVO_FROM_NAME?: string;
  }
}

declare module "cloudflare:workers" {
  export const env: PasswordResetDeliveryBindings & {
    DB?: D1Database;
  };
}
