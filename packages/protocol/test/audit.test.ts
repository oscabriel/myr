import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { auditUser, detectHarness, parseAuditUser } from "../src/audit.ts";

describe("which harness runs the CLI, from its env", () => {
  it.each([
    [{ AI_AGENT: "goose" }, { harness: "goose" }],
    [{ CLAUDECODE: "1" }, { harness: "claude-code" }],
    [{ CLAUDE_CODE: "1" }, { harness: "claude-code" }],
    [{ CLAUDE_CODE_ENTRYPOINT: "cli" }, { harness: "claude-code" }],
    [{ CODEX_SANDBOX: "seatbelt" }, { harness: "codex" }],
    [{ CURSOR_AGENT: "1" }, { harness: "cursor" }],
    [{ OPENCODE: "1" }, { harness: "opencode" }],
    [{ AMP_THREAD_ID: "t-1" }, { harness: "amp" }],
    [{ PI_CODING_AGENT: "true" }, { harness: "pi" }],
    [{ GEMINI_CLI: "1" }, { harness: "gemini" }],
  ] as const)("%o is %o", (env, audit) => {
    expect(detectHarness(env)).toStrictEqual(audit);
  });

  it("takes pi's model and session from the env pi gives its children", () => {
    expect(
      detectHarness({
        AI_AGENT: "pi",
        PI_CODING_AGENT: "true",
        PI_MODEL: "kimi-k3",
        PI_PROVIDER: "moonshot",
        PI_SESSION_ID: "0193-abcd",
      })
    ).toStrictEqual({
      harness: "pi",
      model: "moonshot/kimi-k3",
      session: "0193-abcd",
    });
  });

  it("names AI_AGENT's harness over any other marker", () => {
    expect(detectHarness({ AI_AGENT: "pi", CLAUDECODE: "1" })).toStrictEqual({
      harness: "pi",
    });
  });

  it("finds no harness in a plain shell, or in empty markers", () => {
    expect(
      detectHarness({ HOME: "/home/someone", PATH: "/bin" })
    ).toStrictEqual({});
    expect(detectHarness({ AI_AGENT: "", CLAUDECODE: "" })).toStrictEqual({});
  });
});

describe("the audit username", () => {
  it("carries the harness, model and session as a basic-auth username", () => {
    expect(auditUser({ harness: "pi", model: "kimi-k3" })).toBe(
      "audit;harness=pi&model=kimi-k3"
    );
  });

  it("replaces any character a username can't carry, and stays at 200 characters or fewer", () => {
    const user = auditUser({
      harness: "my agent:v2",
      model: "x".repeat(300),
      session: "a&b=c;d",
    });

    expect(user.startsWith("audit;harness=my_agent_v2&model=x")).toBeTruthy();
    expect(user).toContain("&session=a_b_c_d");
    expect(user.length).toBeLessThanOrEqual(200);
    expect(user).toMatch(/^audit;[A-Za-z0-9._/=&-]*$/u);
  });

  it("reads back what it wrote", () => {
    const audit = {
      harness: "claude-code",
      model: "anthropic/claude-x",
      session: "s-1",
    };

    expect(parseAuditUser(auditUser(audit))).toStrictEqual(Option.some(audit));
    expect(parseAuditUser(auditUser({}))).toStrictEqual(Option.some({}));
  });

  it("is not any other username", () => {
    expect(parseAuditUser("x-access-token")).toStrictEqual(Option.none());
    expect(parseAuditUser("audit;harness")).toStrictEqual(Option.none());
    expect(parseAuditUser("audit;harness=a b")).toStrictEqual(Option.none());
  });
});
