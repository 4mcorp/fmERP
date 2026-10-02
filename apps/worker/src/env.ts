import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
});

export const env = schema.parse(process.env);
