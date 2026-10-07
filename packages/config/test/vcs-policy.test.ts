import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  Decision,
  decide,
  reasons,
} from "../../../scripts/hooks/lib/policy.ts";
import type { Rule } from "../../../scripts/hooks/lib/policy.ts";

/** What a row expects: the command runs, or the rule that refuses it. */
type Verdict = "Allow" | Rule;

const verdictOf = (command: string): Verdict => {
  const decision = decide(command);

  return Decision.$is("Deny")(decision) ? decision.rule : "Allow";
};

/**
 * One refused command: `program` is argv[0], so each row is also tried through
 * a path and through `env`. `lead` is a `VAR=value` word that comes first.
 * Shell builtins (`source`, `.`) have no path and no `env` form.
 */
interface Refused {
  readonly program: string;
  readonly args: string;
  readonly rule: Rule;
  readonly lead?: string;
  readonly builtin?: true;
}

const refused = (
  rule: Rule,
  program: string,
  args: string,
  lead?: string
): Refused =>
  lead === undefined ? { args, program, rule } : { args, lead, program, rule };

/** Every variant the issue's Want names, each refused. */
const WANT: readonly Refused[] = [
  // Hook bypass: --no-verify and the unique prefixes git accepts for it.
  refused("hook-bypass", "git", "commit --no-verify -m x"),
  refused("hook-bypass", "git", "commit --no-verif -m x"),
  refused("hook-bypass", "git", "commit --no-veri -m x"),
  refused("hook-bypass", "git", "commit --no-ver -m x"),
  // `commit -n` and short-flag bundles that carry it.
  refused("hook-bypass", "git", "commit -n -m x"),
  refused("hook-bypass", "git", "commit -nm x"),
  refused("hook-bypass", "git", "commit -anm x"),
  refused("hook-bypass", "git", "-c core.hooksPath=/dev/null commit -m x"),
  refused("hook-bypass", "git", "commit -m x", "LEFTHOOK=0"),
  refused("hook-bypass", "lefthook", "uninstall"),
  // Pushes.
  refused("push", "git", "push"),
  refused("push", "git", "push origin main"),
  // Deletes: wrangler's always; cf's without --dry-run.
  refused("delete", "wrangler", "delete"),
  refused("delete", "wrangler", "delete my-worker"),
  refused(
    "delete",
    "cf",
    "artifacts namespaces repos delete x --namespace y --force"
  ),
  refused("delete", "cf", "accounts tokens revoke x"),
  refused(
    "delete",
    "bun",
    "run ops -- artifacts namespaces repos delete x --force"
  ),
  refused("delete", "bunx", "wrangler delete"),
  // cf's project commands, bare and through bunx, npx and `bun run ops --`.
  ...[
    "dev",
    "build",
    "deploy",
    "init",
    "migrate",
    "previews",
    "workers versions create",
    "workers triggers deploy",
  ].flatMap((command) => [
    refused("cf-project-command", "cf", command),
    refused("cf-project-command", "bunx", `cf ${command}`),
    refused("cf-project-command", "npx", `cf ${command}`),
    refused("cf-project-command", "bun", `run ops -- ${command}`),
  ]),
  // Reads of the closed env files.
  ...["cat", "head", "tail", "less", "more"].flatMap((program) => [
    refused("closed-env-read", program, ".env"),
    refused("closed-env-read", program, ".env.local"),
    refused("closed-env-read", program, "apps/platform/.env.development.local"),
  ]),
  refused("closed-env-read", "sed", "-n 1p .env"),
  refused("closed-env-read", "awk", "'{ print }' .env.local"),
  refused("closed-env-read", "grep", "TOKEN .env"),
  refused("closed-env-read", "rg", "TOKEN .env.production.local"),
  { args: ".env", builtin: true, program: "source", rule: "closed-env-read" },
  { args: ".env.local", builtin: true, program: ".", rule: "closed-env-read" },
];

/** A refused row as written, inside compounds, through a path and through `env`. */
const forms = (row: Refused): readonly string[] => {
  const lead = row.lead === undefined ? "" : `${row.lead} `;
  const plain = `${lead}${row.program} ${row.args}`;

  const compounds = [
    plain,
    `cd x && ${plain}`,
    `true; ${plain}`,
    `(${plain})`,
    `FOO=1 ${plain}`,
  ];

  return row.builtin === true
    ? compounds
    : [
        ...compounds,
        `${lead}/usr/bin/${row.program} ${row.args}`,
        `env ${plain}`,
      ];
};

describe(decide, () => {
  it.each(
    WANT.flatMap((row) => forms(row).map((command) => [command, row.rule]))
  )("refuses %s (%s)", (command, rule) => {
    expect(verdictOf(command)).toBe(rule);
  });

  // Rows past the Want. Where the right answer was unclear, the row denies, and
  // the comment says why.
  it.each<readonly [string, Verdict]>([
    // The value of -m is a message even when it looks like a flag; git takes it
    // whole, so the commit still runs its hooks.
    ['git commit -m "no-verify docs"', "Allow"],
    ['git commit -m "skip --no-verify in docs"', "Allow"],
    ["git commit -m --no-verify", "Allow"],
    ["git commit -mn", "Allow"],
    ["git commit --amend --no-edit", "Allow"],
    ["git commit -am x # --no-verify", "Allow"],
    ["git log -n 5", "Allow"],
    ['git log --grep="--no-verify"', "Allow"],
    ["git --no-pager log -n 5", "Allow"],
    ["git merge -n main", "Allow"],
    ["git stash push -m x", "Allow"],
    ["git config --get core.hooksPath", "Allow"],
    // Quoting and escapes don't hide a flag from the shell, so not from us.
    ['git commit "--no-verify" -m x', "hook-bypass"],
    ['git commit --no-""verify -m x', "hook-bypass"],
    ["git commit --no-\\verify -m x", "hook-bypass"],
    ["git commit $'\\x2d\\x2dno-verify' -m x", "hook-bypass"],
    ["git --no-pager -C repo commit -n -m x", "hook-bypass"],
    ["git -c CORE.HOOKSPATH= commit -m x", "hook-bypass"],
    ["git --config-env=core.hooksPath=HOOKS commit -m x", "hook-bypass"],
    ["git config core.hooksPath /dev/null", "hook-bypass"],
    // An alias can wrap --no-verify or a push, and nothing here can see it.
    ["git -c alias.ci='commit --no-verify' ci -m x", "hook-bypass"],
    ['git config alias.ci "commit --no-verify"', "hook-bypass"],
    ["git merge --no-verify main", "hook-bypass"],
    ["git am -n patch.mbox", "hook-bypass"],
    ["export LEFTHOOK=0", "hook-bypass"],
    ["HUSKY=0 git commit -m x", "hook-bypass"],
    [
      "GIT_CONFIG_PARAMETERS=\"'core.hooksPath'='/dev/null'\" git commit -m x",
      "hook-bypass",
    ],
    ["bunx lefthook uninstall", "hook-bypass"],
    // Help never pushes: git turns `<cmd> --help` into `git help <cmd>`.
    ["git push --help", "Allow"],
    ["git help push", "Allow"],
    // A dry run still talks to a remote, and pushing is the user's step.
    ["git push --dry-run", "push"],
    ["git -C repo push", "push"],
    ["jj git push", "push"],
    // What a shell runs inside a substitution, `-c`, `eval` or a heredoc runs.
    ['echo "$(git push)"', "push"],
    ["echo `git push`", "push"],
    ['bash -c "git push"', "push"],
    ["sh -lc 'git commit -n -m x'", "hook-bypass"],
    ['eval "git push"', "push"],
    ["bash <<'EOF'\ngit push\nEOF", "push"],
    ["xargs git push < refs.txt", "push"],
    ["sudo -u root git push", "push"],
    ["timeout 5 git push", "push"],
    // Text that only mentions a command is not the command.
    ['echo "git push"', "Allow"],
    ["cat <<'EOF'\ngit push\nEOF", "Allow"],
    [
      "git commit -F - <<'EOF'\nSubject\n\n- Don't --no-verify, and don't git push\nEOF",
      "Allow",
    ],
    [
      "git commit -m \"$(cat <<'EOF'\nSubject\n\n- Don't git push\nEOF\n)\"",
      "Allow",
    ],
    // wrangler deploy stays allowed: infra/deploy.ts runs it, and the stage
    // rule lives there. wrangler delete is refused even as a dry run.
    ["wrangler deploy", "Allow"],
    ["wrangler deploy --dry-run", "Allow"],
    ["wrangler deploy --name remove-old", "Allow"],
    ["wrangler delete --dry-run", "delete"],
    ["wrangler queues purge jobs", "delete"],
    ["npx wrangler@4.147.0 delete x", "delete"],
    ["./node_modules/.bin/wrangler d1 delete db", "delete"],
    ["bun run ops -- artifacts namespaces repos delete x --dry-run", "Allow"],
    ["bun run ops -- workers list", "Allow"],
    ["bun run ops -- zones purge-cache x", "delete"],
    ["bun run ops -- workers delete x --dry-run=false", "delete"],
    // cf parses with yargs, which reads `false` after a boolean flag as its
    // value, and the last of `--dry-run` and `--no-dry-run` wins.
    ["bun run ops -- workers delete x --dry-run false", "delete"],
    ["bun run ops -- workers delete x --dry-run --no-dry-run", "delete"],
    ["bun run ops -- workers delete x --no-dry-run --dry-run", "Allow"],
    // AGENTS.md's discovery steps only read: `cli search`, `schema <command>`
    // and `<command> --help` (the help cf itself points to) delete nothing.
    ['bun run ops -- cli search "delete"', "Allow"],
    ["bun run ops -- schema artifacts namespaces repos delete", "Allow"],
    ["bun run ops -- artifacts namespaces repos delete --help", "Allow"],
    // cf's package installs its bin under a second name, `cloudflare`.
    ["./node_modules/.bin/cloudflare deploy", "cf-project-command"],
    ["bunx cloudflare workers delete x", "delete"],
    // cf's project commands are refused even as dry runs, and through varlock.
    ["cf deploy --dry-run", "cf-project-command"],
    ["cf --profile dev deploy", "cf-project-command"],
    // An option cf doesn't declare may take the next word as its value, so
    // any word it could have taken may be the command.
    ["cf --account-id x --env y deploy", "cf-project-command"],
    ["cf --account-id x workers list --name deploy", "Allow"],
    ["bunx varlock run --path infra/ -- cf deploy", "cf-project-command"],
    ["bun run verify", "Allow"],
    ["bun infra/deploy.ts --stage demo", "Allow"],
    // The closed env files, by any path, glob or redirect. Their schemas and
    // examples stay open, and so does searching other files for the name.
    ["cat .env.schema", "Allow"],
    ["cat apps/platform/.env.schema", "Allow"],
    ["cat .env.example", "Allow"],
    ["ls -la .env*", "Allow"],
    ["grep -n .env .gitignore", "Allow"],
    ["rg -n '\\.env' docs", "Allow"],
    ["cat < .env", "closed-env-read"],
    ["while read -r line; do echo $line; done < .env.local", "closed-env-read"],
    ["cat ./.env", "closed-env-read"],
    ['cat "$HOME/project/.env"', "closed-env-read"],
    ["cat .env*", "closed-env-read"],
    ["cat .env{,.local}", "closed-env-read"],
    ["grep -e TOKEN .env", "closed-env-read"],
    ["grep -A 2 TOKEN .env", "closed-env-read"],
    ["grep -f .env other.txt", "closed-env-read"],
    ["cp .env /tmp/x", "closed-env-read"],
    ["set -a; . ./.env; set +a", "closed-env-read"],
    // A recursive grep reads every file under its paths, the closed ones too,
    // unless --include or --exclude keeps them out. A pattern is not a file.
    ["grep -rn TOKEN .", "closed-env-read"],
    ["grep -R TOKEN apps/platform", "closed-env-read"],
    ["grep --recursive TOKEN", "closed-env-read"],
    ["grep -d recurse TOKEN .", "closed-env-read"],
    ["grep -rn TOKEN . --include='*'", "closed-env-read"],
    ["grep -rn TOKEN . --exclude='*.local'", "closed-env-read"],
    ["grep -rn TOKEN . --include='*.ts'", "Allow"],
    ["grep -rn TOKEN . --exclude='.env*'", "Allow"],
    ["grep -rn TOKEN . --exclude=.env --exclude='*.local'", "Allow"],
    ["grep -rn TOKEN . --exclude={.env,.env.local,.env.*.local}", "Allow"],
    ["grep -n -e .env .gitignore", "Allow"],
    // rg skips hidden and git-ignored files; the closed files are both, so it
    // reaches them only when told to search both.
    ["rg TOKEN", "Allow"],
    ["rg --hidden TOKEN", "Allow"],
    ["rg -uu TOKEN", "closed-env-read"],
    ["rg --hidden --no-ignore-vcs TOKEN", "closed-env-read"],
    ["rg -. -u TOKEN", "closed-env-read"],
    ["bun run env:check", "Allow"],
  ])("%s → %s", (command, verdict) => {
    expect(verdictOf(command)).toBe(verdict);
  });

  it("gives each refusal one sentence from AGENTS.md, saying what to do instead", () => {
    expect(decide("git commit -n -m x")).toStrictEqual(
      Decision.Deny({
        reason:
          "Hooks are early feedback; fix the failure instead of skipping it (AGENTS.md principle 11).",
        rule: "hook-bypass",
      })
    );
    expect(reasons).toStrictEqual({
      "cf-project-command":
        "cf's project commands are not our deploy tool; use infra/deploy.ts.",
      "closed-env-read":
        "Never read .env, .env.local or .env.*.local, even in a recursive search (rg and git grep skip them); run bun run env:check.",
      delete: "Deleting Cloudflare resources needs the user's OK.",
      "hook-bypass":
        "Hooks are early feedback; fix the failure instead of skipping it (AGENTS.md principle 11).",
      push: "Pushing is the user's step; commit on the branch and stop.",
    });
    expect(decide("git status")).toStrictEqual(Decision.Allow());
  });
});

// Vitest runs in the package's folder, two below the repo root.
const repoRoot = Effect.map(Path.Path, (path) => path.resolve("..", ".."));

interface Ran {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** Runs the hook as a harness does: `input` on stdin, then stdin closes. */
const hook = (input: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* repoRoot;

      const child = yield* spawner.spawn(
        ChildProcess.make(
          "bun",
          [path.join(root, "scripts/hooks/vcs-policy.ts")],
          {
            cwd: root,
            stdin: Stream.make(new TextEncoder().encode(input)),
          }
        )
      );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [text(child.stdout), text(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { exitCode, stderr, stdout } satisfies Ran;
    })
  ).pipe(Effect.provide(NodeServices.layer));

const CursorReply = Schema.fromJsonString(
  Schema.Struct({
    agent_message: Schema.optionalKey(Schema.String),
    permission: Schema.Literals(["allow", "deny"]),
    user_message: Schema.optionalKey(Schema.String),
  })
);

const claude = (command: string) =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "s",
    tool_input: { command, description: "d" },
    tool_name: "Bash",
  });

const cursor = (command: string) =>
  JSON.stringify({
    command,
    conversation_id: "c",
    cwd: "/repo",
    hook_event_name: "beforeShellExecution",
  });

const PUSH = "Pushing is the user's step; commit on the branch and stop.";

describe("the hook adapter", () => {
  it.live("denies for Claude Code by exit 2, with the reason on stderr", () =>
    Effect.gen(function* () {
      const ran = yield* hook(claude("git commit -n -m x"));

      expect(ran.exitCode).toBe(2);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain(
        "Hooks are early feedback; fix the failure instead of skipping it (AGENTS.md principle 11)."
      );
    })
  );

  it.live("allows for Claude Code by exit 0, saying nothing", () =>
    Effect.gen(function* () {
      expect(yield* hook(claude("git status"))).toStrictEqual({
        exitCode: 0,
        stderr: "",
        stdout: "",
      });
    })
  );

  it.live("denies for Cursor with its JSON reply, and exits 0", () =>
    Effect.gen(function* () {
      const ran = yield* hook(cursor("git push"));
      const reply = yield* Schema.decodeEffect(CursorReply)(ran.stdout);

      expect(ran.exitCode).toBe(0);
      expect(reply.permission).toBe("deny");
      expect(reply.user_message).toContain(PUSH);
      expect(reply.agent_message).toContain(PUSH);
    })
  );

  it.live("allows for Cursor with its JSON reply", () =>
    Effect.gen(function* () {
      const ran = yield* hook(cursor("git status"));

      expect(ran.exitCode).toBe(0);
      expect(yield* Schema.decodeEffect(CursorReply)(ran.stdout)).toStrictEqual(
        { permission: "allow" }
      );
    })
  );

  it.live("judges a bare {command}, denying by exit 2", () =>
    Effect.gen(function* () {
      const denied = yield* hook(JSON.stringify({ command: "git push" }));
      const allowed = yield* hook(JSON.stringify({ command: "git status" }));

      expect(denied.exitCode).toBe(2);
      expect(denied.stderr).toContain(PUSH);
      expect(allowed.exitCode).toBe(0);
    })
  );

  it.live("denies input it cannot read, failing closed", () =>
    Effect.gen(function* () {
      for (const input of ["not json", "{}", '{"command":7}', ""]) {
        const ran = yield* hook(input);

        expect(ran.exitCode).toBe(2);
        expect(ran.stderr).toContain("could not read");
      }
    })
  );
});
