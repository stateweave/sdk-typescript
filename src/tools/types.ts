import type { z } from "zod";

export type Tool = {
  name: string;
  description: string;
  schema: z.ZodSchema;
  execute: (args: unknown) => Promise<unknown>;
};
