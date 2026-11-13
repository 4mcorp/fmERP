import { z } from "@hono/zod-openapi";

export const AGENT_SCOPES = [
  "forms.read",
  "forms.write",
  "forms.publish.propose",
  "documents.read",
  "documents.draft.write",
  "documents.comment.write",
  "documents.submit.propose",
  "org.read",
  "org.history.read",
  "org.write",
  "org.sensitive.propose",
  "invitations.read",
  "invitations.propose",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const AgentTokenInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(AGENT_SCOPES))
    .min(1)
    .max(AGENT_SCOPES.length)
    .refine((scopes) => new Set(scopes).size === scopes.length, "권한이 중복되었습니다"),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  confirmed: z.literal(true),
});
export type AgentTokenInput = z.infer<typeof AgentTokenInputSchema>;

export const AgentTokenSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scopes: z.array(z.enum(AGENT_SCOPES)),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type AgentTokenSummary = z.infer<typeof AgentTokenSummarySchema>;
