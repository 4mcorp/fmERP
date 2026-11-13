import { describe, expect, it } from "vitest";
import { AGENT_SCOPES, AgentTokenInputSchema } from "../src/agent-token-schema";

describe("에이전트 토큰 발급 계약", () => {
  it("scope와 명시적 확인 없이는 발급하지 않는다", () => {
    for (const value of [
      {},
      { name: "연결", scopes: [], confirmed: true },
      { name: "연결", scopes: ["all"], confirmed: true },
      { name: "연결", scopes: ["org.read"], confirmed: false },
    ]) {
      expect(AgentTokenInputSchema.safeParse(value).success).toBe(false);
    }
  });
  it("기본 7일, 최대 30일이고 알 수 없는 필드를 거부한다", () => {
    const input = { name: "연결", scopes: ["org.read"], confirmed: true };
    expect(AgentTokenInputSchema.parse(input).expiresInDays).toBe(7);
    expect(AgentTokenInputSchema.safeParse({ ...input, expiresInDays: 30 }).success).toBe(true);
    for (const expiresInDays of [0, 31, 1.5])
      expect(AgentTokenInputSchema.safeParse({ ...input, expiresInDays }).success).toBe(false);
    expect(AgentTokenInputSchema.safeParse({ ...input, accountId: "other" }).success).toBe(false);
    expect(AGENT_SCOPES).toHaveLength(13);
  });
});
