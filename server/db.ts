import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure pool for serverless compatibility
// In serverless environments, connections are short-lived
// so we use a smaller pool and shorter idle timeout
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Serverless-friendly settings
  max: isServerless ? 1 : 10, // Single connection per function in serverless
  idleTimeoutMillis: isServerless ? 30000 : 30000, // 30 seconds
  connectionTimeoutMillis: 10000, // 10 seconds
  // Use connection pooler URL if available (recommended for serverless)
  // Supabase provides pooler URLs that work better with serverless
});

// Handle pool errors gracefully
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export const db = drizzle(pool, { schema });
