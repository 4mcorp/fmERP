import { createDatabase, type Database } from "@fmerp/db";
import { getEnv } from "./env";

let database: Database | undefined;

export function getDatabase(): Database {
  database ??= createDatabase(getEnv().DATABASE_URL);
  return database;
}
