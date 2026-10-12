import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { RefName, RepoName } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import type { Command } from "@repo/git/custody";
import { Projects } from "@repo/project/projects";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  keyOf,
  addressOfRepo,
  repoNameOfAddress,
  RepoPath,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  ClaimLapsed,
  DirectPush,
  NotClaimed,
  OutOfScope,
  UnknownProject,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { git, gitOk } from "@repo/testkit/git";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, DateTime, Effect, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { custodyFor, pushRequestId } from "../src/adapters/custody.ts";
import { WorkerFetch } from "../src/adapters/fetch.ts";
import { repoKind } from "../src/repo-names.ts";
import {
  alice,
  as,
  bob,
  commit,
  gatewayWorld,
  tokens,
} from "./gateway.fixtures.ts";

const datekit = ProjectName.make("alice/datekit");

const notesRef = `refs/notes/${Brand.slug}`;

const parseIso = AskId.make("parse-iso");

const fresh = ProjectName.make("alice/fresh");

const scenario = aProject({ name: datekit, people: ["bob"] }).pipe(
  withAsk({ id: parseIso, territory: "packages/parser" }),
  withVouches(["bob"])
);

const askOf = (id: AskId) =>
  Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, (ask) => ask.id === id)
  );

const withDatekit = Effect.gen(function* () {
  const world = yield* gatewayWorld([scenario]);
  const seed = `${world.root}/seed`;
  const api = yield* world.projects.create(datekit).pipe(Effect.orDie);

  yield* api.initProject(alice, {}).pipe(Effect.orDie);
  yield* gitOk(world.root, "init", "--quiet", "--initial-branch=main", seed);

  const first = yield* commit(seed, "first", {
    "README.md": "datekit\n",
    "packages/parser/src/parse.ts": "export const parse = (s) => s;\n",
  });

  yield* gitOk(
    seed,
    "push",
    "--quiet",
    `${world.repos}/${keyOf(datekit)}.git`,
    "HEAD:refs/heads/main"
  );
  yield* api.recordFirstPush(alice, first).pipe(Effect.orDie);

  const { landed } = yield* world.openAsk(
    api,
    LandedSha.make(first),
    askOf(parseIso)
  );

  return { ...world, api, first, landed, seed };
});

const remoteLines = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("remote: "))
    .map((line) => line.trimEnd());

const refusedAs = (ref: string) => ({
  exitCode: 1,
  remote: explain([new DirectPush({ ref })]).map((line) => `remote: ${line}`),
});

const request = (url: string, authorization?: string) =>
  Fetch.use(({ fetch }) =>
    fetch(
      new Request(url, {
        headers: authorization === undefined ? {} : { authorization },
      })
    )
  ).pipe(
    Effect.map((response) => ({
      basic:
        response.headers.get("www-authenticate")?.startsWith("Basic ") ?? false,
      status: response.status,
    })),
    Effect.orDie,
    Effect.provide(WorkerFetch)
  );

describe("git through the platform", () => {
  it.live(
    "1. anyone clones a project's canonical repo, with no credential",
    () =>
      Effect.gen(function* () {
        const { landed, root, urlOf } = yield* withDatekit;
        const clone = `${root}/clone`;
        const cloned = yield* git(root, "clone", urlOf(datekit), clone);

        expect(cloned.exitCode).toBe(0);
        expect(yield* gitOk(clone, "rev-parse", "HEAD")).toBe(landed);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "2. a maintainer's push to canonical main is DirectPush, and main stays where it was",
    () =>
      Effect.gen(function* () {
        const { landed, repos, root, urlOf } = yield* withDatekit;
        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", urlOf(datekit), clone);
        yield* commit(clone, "straight to main", { "README.md": "mine\n" });

        const pushed = yield* git(
          clone,
          ...as(tokens.alice),
          "push",
          "origin",
          "HEAD:main"
        );

        expect(pushed.exitCode).toBe(1);
        expect(remoteLines(pushed.stderr)).toStrictEqual(
          explain([new DirectPush({ ref: "refs/heads/main" })]).map(
            (line) => `remote: ${line}`
          )
        );
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> main (DirectPush)"
        );
        expect(
          yield* gitOk(`${repos}/${keyOf(datekit)}.git`, "rev-parse", "main")
        ).toBe(landed);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "3. an empty project takes its initializer's first push once; the next is DirectPush",
    () =>
      Effect.gen(function* () {
        const { projects, repos, root, urlOf } = yield* gatewayWorld([
          scenario,
        ]);

        const api = yield* projects.create(fresh).pipe(Effect.orDie);

        yield* api.initProject(alice, {}).pipe(Effect.orDie);

        const work = `${root}/work`;

        yield* gitOk(root, "init", "--quiet", "--initial-branch=main", work);

        const first = yield* commit(work, "first", { "README.md": "fresh\n" });

        const byBob = yield* git(
          work,
          ...as(tokens.bob),
          "push",
          urlOf(fresh),
          "HEAD:main"
        );

        const byAlice = yield* git(
          work,
          ...as(tokens.alice),
          "push",
          urlOf(fresh),
          "HEAD:main"
        );

        const mainAfterFirst = yield* gitOk(
          `${repos}/${keyOf(fresh)}.git`,
          "rev-parse",
          "main"
        );

        const second = yield* commit(work, "second", { "README.md": "two\n" });

        const again = yield* git(
          work,
          ...as(tokens.alice),
          "push",
          urlOf(fresh),
          "HEAD:main"
        );

        const refused = " ! [remote rejected] HEAD -> main (DirectPush)";

        expect({
          again: again.stderr.includes(refused),
          bob: byBob.stderr.includes(refused),
          first: byAlice.exitCode,
          main: mainAfterFirst,
        }).toStrictEqual({ again: true, bob: true, first: 0, main: first });
        expect(
          yield* gitOk(`${repos}/${keyOf(fresh)}.git`, "rev-parse", "main")
        ).toBe(first);
        expect(
          yield* Effect.flip(api.recordFirstPush(alice, second))
        ).toStrictEqual(new DirectPush({ ref: "refs/heads/main" }));
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "4. a push to someone else's claim fork is NotClaimed, before the upstream hears of it",
    () =>
      Effect.gen(function* () {
        const { api, repos, root, seen, urlOf } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);
        const clone = `${root}/bobs`;

        yield* gitOk(
          root,
          ...as(tokens.bob),
          "clone",
          "--quiet",
          urlOf(claim.fork),
          clone
        );
        yield* commit(clone, "bob's", {
          "packages/parser/src/parse.ts":
            "export const parse = (s) => s.trim();\n",
        });

        const before = yield* gitOk(
          `${repos}/${claim.fork}.git`,
          "rev-parse",
          "main"
        );

        const pushed = yield* git(
          clone,
          ...as(tokens.bob),
          "push",
          "origin",
          "HEAD:main"
        );

        expect(pushed.exitCode).toBe(1);
        expect(remoteLines(pushed.stderr)).toStrictEqual(
          explain([NotClaimed.of(parseIso)]).map((line) => `remote: ${line}`)
        );
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> main (NotClaimed)"
        );
        expect(
          yield* gitOk(`${repos}/${claim.fork}.git`, "rev-parse", "main")
        ).toBe(before);
        expect(
          (yield* Ref.get(seen.upstream)).filter(
            ({ method, path }) =>
              method === "POST" && path.endsWith("/git-receive-pack")
          )
        ).toStrictEqual([]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "5. an out-of-territory push to your own claim fork is OutOfScope, and the fork keeps it",
    () =>
      Effect.gen(function* () {
        const { api, root, urlOf } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);
        const clone = `${root}/alices`;

        yield* gitOk(
          root,
          ...as(tokens.alice),
          "clone",
          "--quiet",
          urlOf(claim.fork),
          clone
        );

        const wide = yield* commit(clone, "too wide", {
          "README.md": "a different readme\n",
          "packages/parser/src/parse.ts":
            "export const parse = (s) => s.trim();\n",
        });

        const pushed = yield* git(
          clone,
          ...as(tokens.alice),
          "push",
          "origin",
          "HEAD:main"
        );

        const listed = yield* gitOk(
          root,
          ...as(tokens.alice),
          "ls-remote",
          urlOf(claim.fork),
          "refs/heads/main"
        );

        expect(pushed.exitCode).toBe(1);
        expect(remoteLines(pushed.stderr)).toStrictEqual(
          explain([
            new OutOfScope({ paths: [RepoPath.make("README.md")] }),
          ]).map((line) => `remote: ${line}`)
        );
        expect(pushed.stderr).toContain(
          " ! [remote rejected] HEAD -> main (OutOfScope)"
        );
        expect(listed).toBe(`${wide}\trefs/heads/main`);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "6. an unknown token is a 401 asking for Basic, and so is a push with no credential",
    () =>
      Effect.gen(function* () {
        const { origin, root, urlOf } = yield* withDatekit;

        const unknown = yield* request(
          `${origin}/${datekit}.git/info/refs?service=git-upload-pack`,
          `Basic ${btoa("x:a-token-nobody-was-given-0123456789")}`
        );

        const anonymousPush = yield* request(
          `${origin}/${datekit}.git/info/refs?service=git-receive-pack`
        );

        const clone = `${root}/clone`;

        yield* gitOk(root, "clone", "--quiet", urlOf(datekit), clone);
        yield* commit(clone, "anonymous", { "README.md": "who\n" });

        const pushed = yield* git(clone, "push", "origin", "HEAD:main");

        expect(unknown).toStrictEqual({ basic: true, status: 401 });
        expect(anonymousPush).toStrictEqual({ basic: true, status: 401 });
        expect(pushed.exitCode).toBe(128);
        expect(pushed.stderr).toContain("could not read Username");
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a clean push to your own claim fork is offered as the answer, and says it is being checked",
    () =>
      Effect.gen(function* () {
        const { api, root, seen, urlOf } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);
        const clone = `${root}/alices`;

        const cloned = yield* git(
          root,
          ...as(tokens.alice),
          "clone",
          urlOf(claim.fork),
          clone
        );

        const fix = yield* commit(clone, "parse the year", {
          "packages/parser/src/parse.ts":
            "export const parse = (s) => ({ year: 2026 });\n",
        });

        const pushed = yield* git(
          clone,
          ...as(tokens.alice),
          "push",
          "origin",
          "HEAD:main"
        );

        const requestId = pushRequestId(alice.handle, fix);
        const { answers } = yield* api.status(alice);

        expect(pushed.exitCode).toBe(0);
        expect(remoteLines(pushed.stderr)).toStrictEqual([
          `remote: checking ${parseIso} at ${fix.slice(0, 7)}; follow with ${Brand.cli} status`,
        ]);
        expect(
          answers.map((answer) => [answer.requestId, answer.head])
        ).toStrictEqual([[requestId, fix]]);
        expect(yield* Ref.get(seen.started)).toStrictEqual([requestId]);

        const minted = yield* Ref.get(seen.minted);

        const credentials = new Set(
          minted.map((secret) => `Basic ${btoa(`x:${secret}`)}`)
        );

        const output = [
          cloned.stdout,
          cloned.stderr,
          pushed.stdout,
          pushed.stderr,
        ].join("\n");

        expect({
          leaked: [...minted, tokens.alice].filter((secret) =>
            output.includes(secret)
          ),
          minted: minted.length > 0,
          sent: (yield* Ref.get(seen.upstream)).filter(
            ({ authorization }) =>
              !Option.exists(authorization, (header) => credentials.has(header))
          ),
        }).toStrictEqual({ leaked: [], minted: true, sent: [] });
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a claimant's push of the notes ref, a tag or the platform's merge ref to their claim fork is DirectPush, and the fork keeps only its branches",
    () =>
      Effect.gen(function* () {
        const { api, repos, root, seen, urlOf } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);
        const clone = `${root}/alices`;
        const forkRepo = `${repos}/${claim.fork}.git`;

        yield* gitOk(
          root,
          ...as(tokens.alice),
          "clone",
          "--quiet",
          urlOf(claim.fork),
          clone
        );
        yield* gitOk(clone, "notes", `--ref=${Brand.slug}`, "add", "-m", "{}");
        yield* gitOk(clone, "tag", "v1");

        const refsBefore = yield* gitOk(forkRepo, "for-each-ref");

        const pushOf = (refspec: string) =>
          Effect.map(
            git(clone, ...as(tokens.alice), "push", "origin", refspec),
            ({ exitCode, stderr }) => ({
              exitCode,
              remote: remoteLines(stderr),
            })
          );

        const merge = `${Brand.refsPrefix}merge/${"a".repeat(40)}`;

        expect({
          merge: yield* pushOf(`HEAD:${merge}`),
          notes: yield* pushOf(notesRef),
          tag: yield* pushOf("refs/tags/v1"),
        }).toStrictEqual({
          merge: refusedAs(merge),
          notes: refusedAs(notesRef),
          tag: refusedAs("refs/tags/v1"),
        });
        expect(yield* gitOk(forkRepo, "for-each-ref")).toBe(refsBefore);
        expect(
          (yield* Ref.get(seen.upstream)).filter(
            ({ method, path }) =>
              method === "POST" && path.endsWith("/git-receive-pack")
          )
        ).toStrictEqual([]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a claimant's deletion of their claim fork's notes ref is DirectPush, and the verdict notes stay",
    () =>
      Effect.gen(function* () {
        const { api, repos, root, urlOf } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);
        const clone = `${root}/alices`;
        const forkRepo = `${repos}/${claim.fork}.git`;

        yield* gitOk(
          root,
          ...as(tokens.alice),
          "clone",
          "--quiet",
          urlOf(claim.fork),
          clone
        );

        yield* gitOk(clone, "notes", `--ref=${Brand.slug}`, "add", "-m", "{}");
        yield* gitOk(clone, "push", "--quiet", forkRepo, notesRef);

        const noted = yield* gitOk(forkRepo, "rev-parse", notesRef);

        const pushed = yield* git(
          clone,
          ...as(tokens.alice),
          "push",
          "origin",
          `:${notesRef}`
        );

        expect({
          exitCode: pushed.exitCode,
          remote: remoteLines(pushed.stderr),
        }).toStrictEqual(refusedAs(notesRef));
        expect(yield* gitOk(forkRepo, "rev-parse", notesRef)).toBe(noted);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a claimant's push of main beside a tag is refused whole: main stays and nothing is offered",
    () =>
      Effect.gen(function* () {
        const { api, repos, root, seen, urlOf } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);
        const clone = `${root}/alices`;
        const forkRepo = `${repos}/${claim.fork}.git`;

        yield* gitOk(
          root,
          ...as(tokens.alice),
          "clone",
          "--quiet",
          urlOf(claim.fork),
          clone
        );
        yield* commit(clone, "parse the year", {
          "packages/parser/src/parse.ts":
            "export const parse = (s) => ({ year: 2026 });\n",
        });
        yield* gitOk(clone, "tag", "v1");

        const before = yield* gitOk(forkRepo, "rev-parse", "main");

        const pushed = yield* git(
          clone,
          ...as(tokens.alice),
          "push",
          "origin",
          "HEAD:main",
          "refs/tags/v1"
        );

        expect({
          exitCode: pushed.exitCode,
          remote: remoteLines(pushed.stderr),
        }).toStrictEqual(refusedAs("refs/tags/v1"));
        expect(
          [" HEAD -> main (DirectPush)", " v1 -> v1 (DirectPush)"].map(
            (rejected) =>
              pushed.stderr.includes(` ! [remote rejected]${rejected}`)
          )
        ).toStrictEqual([true, true]);
        expect(yield* gitOk(forkRepo, "rev-parse", "main")).toBe(before);
        expect(yield* Ref.get(seen.started)).toStrictEqual([]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a fork is read by signed-in people, and a name the platform never makes is a 404",
    () =>
      Effect.gen(function* () {
        const { api, origin } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);

        const refs = (repo: string) =>
          `${origin}/${
            repo.includes("/")
              ? repo
              : Option.getOrElse(addressOfRepo(RepoName.make(repo)), () => repo)
          }.git/info/refs?service=git-upload-pack`;

        expect(yield* request(refs(claim.fork))).toStrictEqual({
          basic: true,
          status: 401,
        });
        expect(
          (yield* request(refs(claim.fork), `Bearer ${tokens.bob}`)).status
        ).toBe(200);
        expect(
          (yield* request(refs(`${keyOf(datekit)}--layer--alice`))).status
        ).toBe(404);
        expect(
          (yield* request(refs(`${datekit}--${parseIso}--Alice`))).status
        ).toBe(404);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );
});

describe("a push's request id", () => {
  it("names the whole head, then as much of the pusher as fits", () => {
    const head = CommitSha.make("0123456789abcdef0123456789abcdef01234567");
    const next = CommitSha.make("0123456789abcdef0123456789abcdef01234568");
    const long = Handle.make(`Long-${"handle".repeat(10)}`);

    expect([
      pushRequestId(alice.handle, head),
      pushRequestId(bob.handle, head),
      pushRequestId(long, head),
      pushRequestId(long, next),
    ]).toStrictEqual([
      `push-${head}-alice`,
      `push-${head}-bob`,
      `push-${head}-long-handlehandleh`,
      `push-${next}-long-handlehandleh`,
    ]);
  });
});

const carol = Person.make({ handle: Handle.make("carol") });

const mainRef = RefName.make("refs/heads/main");

const moving = (ref: RefName, from: Option.Option<CommitSha>): Command => ({
  from,
  ref,
  to: Option.some(CommitSha.make("c".repeat(40))),
});

const judged = (
  projects: Projects["Service"],
  pusher: Person,
  repo: string,
  commands: Array.NonEmptyReadonlyArray<Command>
) =>
  Effect.gen(function* () {
    const name = Option.getOrElse(repoNameOfAddress(repo), () =>
      RepoName.make(repo)
    );

    const custody = yield* custodyFor(pusher, repoKind(name));

    return {
      admitted: yield* custody.admit(name, commands),
      reviewed: yield* custody.review(name, commands),
    };
  }).pipe(Effect.provideService(Projects, projects));

describe("custody of one push", () => {
  it.live(
    "a claim's fork takes its claimant's pushes while the claim is live, and a lapsed claim is ClaimLapsed",
    () =>
      Effect.gen(function* () {
        const { api, landed, projects } = yield* withDatekit;
        const { claim } = yield* api.claim(alice, parseIso).pipe(Effect.orDie);
        const push = Array.of(moving(mainRef, Option.some(landed)));

        const live = yield* custodyFor(alice, repoKind(claim.fork)).pipe(
          Effect.flatMap((custody) => custody.admit(claim.fork, push)),
          Effect.provideService(Projects, projects)
        );

        const lapsed = yield* Effect.gen(function* () {
          yield* TestClock.setTime(
            DateTime.toEpochMillis(
              DateTime.addDuration(claim.lapsesAt, "1 minute")
            )
          );
          yield* api.onAlarm();

          const custody = yield* custodyFor(alice, repoKind(claim.fork));

          return yield* custody.admit(claim.fork, push);
        }).pipe(
          Effect.provideService(Projects, projects),
          Effect.provide(TestClock.layer())
        );

        expect(live).toStrictEqual([]);
        expect(lapsed).toStrictEqual([ClaimLapsed.of(parseIso)]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a maintainer pushes onto someone's claim fork to finish its answer, which the push itself does not offer",
    () =>
      Effect.gen(function* () {
        const { api, landed, projects, seen } = yield* withDatekit;
        const { claim } = yield* api.claim(bob, parseIso).pipe(Effect.orDie);
        const push = Array.of(moving(mainRef, Option.some(landed)));

        expect(yield* judged(projects, alice, claim.fork, push)).toStrictEqual({
          admitted: [],
          reviewed: [],
        });
        expect(yield* Ref.get(seen.started)).toStrictEqual([]);
        expect(
          (yield* judged(projects, carol, claim.fork, push)).admitted
        ).toStrictEqual([NotClaimed.of(parseIso)]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a working fork takes its owner's pushes only",
    () =>
      Effect.gen(function* () {
        const { projects } = yield* withDatekit;
        const fork = `${keyOf(datekit)}--me--alice`;
        const push = Array.of(moving(mainRef, Option.none()));

        expect(yield* judged(projects, alice, fork, push)).toStrictEqual({
          admitted: [],
          reviewed: [],
        });
        expect(
          (yield* judged(projects, bob, fork, push)).admitted
        ).toStrictEqual([new DirectPush({ ref: mainRef })]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a fork takes branches only, whoever pushes: a working fork's owner and a finishing maintainer hear DirectPush for a tag",
    () =>
      Effect.gen(function* () {
        const { api, landed, projects } = yield* withDatekit;
        const { claim } = yield* api.claim(bob, parseIso).pipe(Effect.orDie);
        const working = `${keyOf(datekit)}--me--alice`;
        const tag = RefName.make("refs/tags/v1");
        const side = RefName.make("refs/heads/side");
        const tagged = Array.of(moving(tag, Option.none()));

        const deletion = Array.of<Command>({
          from: Option.some(CommitSha.make(landed)),
          ref: RefName.make(notesRef),
          to: Option.none(),
        });

        expect({
          decider: (yield* judged(projects, alice, claim.fork, tagged))
            .admitted,
          deletion: (yield* judged(projects, bob, claim.fork, deletion))
            .admitted,
          owner: (yield* judged(projects, alice, working, tagged)).admitted,
          ownerBranch: (yield* judged(
            projects,
            alice,
            working,
            Array.of(moving(side, Option.none()))
          )).admitted,
        }).toStrictEqual({
          decider: [new DirectPush({ ref: tag })],
          deletion: [new DirectPush({ ref: notesRef })],
          owner: [new DirectPush({ ref: tag })],
          ownerBranch: [],
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a canonical repo takes no ref but main, and its first push only from its initializer, as the project says",
    () =>
      Effect.gen(function* () {
        const { projects } = yield* gatewayWorld([scenario]);
        const api = yield* projects.create(fresh).pipe(Effect.orDie);
        const side = RefName.make("refs/heads/side");

        const first = Array.make(
          moving(mainRef, Option.none()),
          moving(side, Option.none())
        );

        yield* api.initProject(alice, {}).pipe(Effect.orDie);

        const byBob = yield* judged(projects, bob, fresh, first);
        const byAlice = yield* judged(projects, alice, fresh, first);

        const unmade = yield* judged(
          projects,
          alice,
          ProjectName.make("alice/nokit"),
          first
        );

        expect(byAlice.admitted).toStrictEqual([new DirectPush({ ref: side })]);
        expect(byBob.admitted).toStrictEqual([
          new DirectPush({ ref: mainRef }),
          new DirectPush({ ref: side }),
        ]);
        expect(unmade.admitted).toStrictEqual(byBob.admitted);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a push to a project nobody made is UnknownProject",
    () =>
      Effect.gen(function* () {
        const { projects } = yield* gatewayWorld([scenario]);
        const nobody = ProjectName.make("alice/nokit");
        const push = Array.of(moving(mainRef, Option.none()));

        expect(
          (yield* judged(
            projects,
            alice,
            `${keyOf(nobody)}--${parseIso}--alice`,
            push
          )).admitted
        ).toStrictEqual([new UnknownProject({ project: nobody })]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );
});
