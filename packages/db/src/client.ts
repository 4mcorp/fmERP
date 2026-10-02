import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { pool, db };
}

export type Database = ReturnType<typeof createDatabase>;

export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
