import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  agentTokenMatches,
  isAgentAuthConfigured,
  parseBearerToken,
  pickUserWithHousehold,
  type AgentUserCandidate,
} from "./auth";

const prevToken = process.env.AGENT_API_TOKEN;

describe("agent bearer auth", () => {
  beforeEach(() => {
    delete process.env.AGENT_API_TOKEN;
  });
  afterEach(() => {
    if (prevToken === undefined) delete process.env.AGENT_API_TOKEN;
    else process.env.AGENT_API_TOKEN = prevToken;
  });

  it("parses Authorization: Bearer", () => {
    assert.equal(parseBearerToken("Bearer secret-token"), "secret-token");
    assert.equal(parseBearerToken("bearer secret-token"), "secret-token");
    assert.equal(parseBearerToken("Basic abc"), null);
    assert.equal(parseBearerToken(null), null);
    assert.equal(parseBearerToken(""), null);
  });

  it("rejects missing or empty configured token", () => {
    assert.equal(isAgentAuthConfigured(), false);
    assert.equal(agentTokenMatches("anything"), false);
    process.env.AGENT_API_TOKEN = "";
    assert.equal(isAgentAuthConfigured(), false);
  });

  it("accepts only the exact configured token", () => {
    process.env.AGENT_API_TOKEN = "test-agent-token-not-a-finance-figure";
    assert.equal(isAgentAuthConfigured(), true);
    assert.equal(
      agentTokenMatches("test-agent-token-not-a-finance-figure"),
      true,
    );
    assert.equal(agentTokenMatches("wrong"), false);
    assert.equal(agentTokenMatches(""), false);
  });
});

describe("pickUserWithHousehold", () => {
  const base = {
    email: "lucianoolivabianco@gmail.com",
    name: "Admin",
    image: null,
  };

  it("returns null for empty candidates", () => {
    assert.equal(pickUserWithHousehold([]), null);
  });

  it("prefers the candidate with household membership", () => {
    const stub: AgentUserCandidate = {
      id: "wrong-agent-id",
      ...base,
      hasHousehold: false,
    };
    const hogar: AgentUserCandidate = {
      id: "pwa-user-with-hogar",
      ...base,
      hasHousehold: true,
    };
    const picked = pickUserWithHousehold([stub, hogar]);
    assert.equal(picked?.id, "pwa-user-with-hogar");
  });

  it("returns null when nobody has a household (no stub fallback)", () => {
    const onlyStub: AgentUserCandidate = {
      id: "orphan-id",
      ...base,
      hasHousehold: false,
    };
    assert.equal(pickUserWithHousehold([onlyStub]), null);
  });

  it("returns the household user even if listed first", () => {
    const hogar: AgentUserCandidate = {
      id: "owner",
      ...base,
      hasHousehold: true,
    };
    const other: AgentUserCandidate = {
      id: "other",
      email: "other@example.com",
      name: null,
      image: null,
      hasHousehold: false,
    };
    assert.equal(pickUserWithHousehold([hogar, other])?.id, "owner");
  });
});
