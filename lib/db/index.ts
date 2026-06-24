import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Neon's HTTP driver: serverless-friendly, no connection pooling to manage.
// Good fit for Vercel functions. (No interactive transactions, which is fine
// for our access patterns.)
const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
export type DB = typeof db;
