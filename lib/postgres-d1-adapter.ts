import { Pool, type PoolClient, type QueryResultRow } from "pg";

type QueryExecutor = Pool | PoolClient;

function replaceQuestionMarkPlaceholders(query: string): string {
  let parameterIndex = 0;
  let result = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];

    if (quote) {
      result += character;
      if (character === quote) {
        if (query[index + 1] === quote) {
          result += query[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      result += character;
      continue;
    }

    if (character === "?") {
      parameterIndex += 1;
      result += `$${parameterIndex}`;
      continue;
    }

    result += character;
  }

  return result;
}

export function toPostgresSql(query: string): string {
  // Follow-up inboxes filter against current authorized parcel IDs with one JSON
  // array bind, avoiding D1's parameter limit and stale denormalized assignments.
  const compatible = query.replaceAll(
    "IN (SELECT value FROM json_each(?))",
    "IN (SELECT value FROM jsonb_array_elements_text(CAST(? AS jsonb)) AS allowed_orders(value))",
  ).replaceAll(
    "json_extract(payload, '$.status')",
    "(CAST(payload AS jsonb) ->> 'status')",
  );
  return replaceQuestionMarkPlaceholders(compatible);
}

async function executeQuery(executor: QueryExecutor, query: string, values: unknown[]) {
  return executor.query<QueryResultRow>(toPostgresSql(query), values);
}

class PostgresD1Statement implements D1PreparedStatement {
  private readonly pool: Pool;
  private readonly query: string;
  private readonly values: unknown[];

  constructor(
    pool: Pool,
    query: string,
    values: unknown[] = [],
  ) {
    this.pool = pool;
    this.query = query;
    this.values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new PostgresD1Statement(this.pool, this.query, values);
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const result = await this.execute(this.pool);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.execute(this.pool);
    return {
      results: result.rows as T[],
      success: true,
      meta: { changes: result.rowCount ?? 0 },
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.execute(this.pool);
    return {
      results: result.rows as T[],
      success: true,
      meta: { changes: result.rowCount ?? 0 },
    };
  }

  execute(executor: QueryExecutor) {
    return executeQuery(executor, this.query, this.values);
  }
}

export class PostgresD1Database implements D1Database {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  prepare(query: string): D1PreparedStatement {
    return new PostgresD1Statement(this.pool, query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const results: D1Result[] = [];

      for (const statement of statements) {
        if (!(statement instanceof PostgresD1Statement)) {
          throw new Error("The PostgreSQL batch received an incompatible statement.");
        }

        const result = await statement.execute(client);
        results.push({
          results: result.rows,
          success: true,
          meta: { changes: result.rowCount ?? 0 },
        });
      }

      await client.query("COMMIT");
      return results as T[];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  exec(query: string): Promise<unknown> {
    return this.pool.query(query);
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

let activeDatabaseUrl = "";
let activeDatabase: PostgresD1Database | null = null;

export function getRenderDatabase(): D1Database {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when the application runs on Render.");
  }

  if (!activeDatabase || activeDatabaseUrl !== databaseUrl) {
    activeDatabaseUrl = databaseUrl;
    activeDatabase = new PostgresD1Database(new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Release database resources even when a query/transaction is stalled.
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 15_000,
    }));
  }

  return activeDatabase;
}
