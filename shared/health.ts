import * as z from 'zod/mini';

export const healthSchema = z.strictObject({
  status: z.literal('ready'),
  service: z.literal('bid-and-build'),
  schemaVersion: z.int().check(z.positive()),
});
export type Health = z.infer<typeof healthSchema>;
