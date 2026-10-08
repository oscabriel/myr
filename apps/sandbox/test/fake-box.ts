/**
 * The Checker's capabilities as fakes that record every call, in order, in
 * one list: the container (`Box`), its network, its snapshots, where its logs
 * go, and the Worker's own log lines. A test scripts what each command prints
 * and reads back what the Checker did, phase by phase.
 */
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer, Logger, Redacted, References } from "effect";

import { Box } from "../src/box.ts";
import type { BoxFailed, ExecOptions, Executed } from "../src/box.ts";
import { CheckLogs } from "../src/checker/logs.ts";
import type { PhaseLog } from "../src/checker/logs.ts";
import { Network } from "../src/checker/network.ts";
import { Snapshots } from "../src/checker/snapshots.ts";
import type { EnvGatewayProps } from "../src/env-gateway.ts";
import type { CloneProps, EgressProps } from "../src/outbound.ts";

/** What the container could reach at one moment. */
export type Reach = "clone route" | readonly string[];

/** One thing the Checker did, as the fakes saw it. */
export type Call =
  | {
      readonly kind: "exec";
      readonly argv: readonly string[];
      readonly options: ExecOptions;
      /**
       * What the network let out as the command started: the clone route
       * alone before the first `allow`, then the hosts that `allow` named.
       */
      readonly network: Reach;
    }
  | { readonly kind: "writeFile"; readonly path: string; readonly text: string }
  | { readonly kind: "destroy" }
  | {
      readonly kind: "route";
      readonly host: string;
      readonly remote: string;
      readonly token: string;
    }
  | { readonly kind: "allow"; readonly hosts: readonly string[] }
  | {
      readonly kind: "intercept";
      readonly host: string;
      /** How many values the env gateway holds for the job; never which. */
      readonly values: number;
    }
  | { readonly kind: "save"; readonly key: string }
  | { readonly kind: "restore"; readonly key: string; readonly hit: boolean }
  | { readonly kind: "report"; readonly logs: readonly PhaseLog[] }
  | {
      readonly kind: "log";
      readonly level: string;
      readonly message: string;
      readonly annotations: Readonly<Record<string, string>>;
    };

/** What a command left, for a script. */
export const exited = (
  exitCode: number,
  output: { readonly stdout?: string; readonly stderr?: string } = {}
): Effect.Effect<Executed, BoxFailed> =>
  Effect.succeed({
    exitCode,
    stderr: output.stderr ?? "",
    stdout: output.stdout ?? "",
  });

export interface FakeOptions {
  /**
   * What `sh -c <command>` does, by command (setup and lanes). A command not
   * listed exits 0 and prints nothing.
   */
  readonly commands?: ReadonlyMap<string, Effect.Effect<Executed, BoxFailed>>;
  /** What `git ls-tree` prints: the lockfiles at the checked-out tree. */
  readonly lockfiles?: string;
  /** Snapshot keys kept so far, shared by the jobs a test runs. */
  readonly snapshots?: Set<string>;
  /** What writing a file does, by path; every write succeeds when absent. */
  readonly writeFile?: (path: string) => Effect.Effect<void, BoxFailed>;
}

/** A lockfile listing, as `git ls-tree HEAD -- <names>` prints one. */
export const LOCKFILES =
  "100644 blob 8f2c1d0e9b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d\tbun.lock\n";

/** The command `sh -c <command>` runs, or none for any other argv. */
const shellCommandOf = (argv: readonly string[]) =>
  argv[0] === "sh" && argv[1] === "-c" ? argv[2] : undefined;

/** The fakes for one job, and the list their calls go to. */
export const fakeChecker = (options: FakeOptions = {}) => {
  const calls: Call[] = [];
  const kept = options.snapshots ?? new Set<string>();
  let reach: Reach = "clone route";

  const run = (argv: readonly string[]): Effect.Effect<Executed, BoxFailed> => {
    if (argv[0] === "git" && argv.includes("ls-tree")) {
      return exited(0, { stdout: options.lockfiles ?? LOCKFILES });
    }

    if (argv[0] === "git" && argv.includes("commit-tree")) {
      return exited(0, { stdout: `${"c".repeat(40)}\n` });
    }

    const command = shellCommandOf(argv);

    return (
      (command === undefined ? undefined : options.commands?.get(command)) ??
      exited(0)
    );
  };

  const box = Layer.succeed(
    Box,
    Box.of({
      destroy: () => Effect.sync(() => calls.push({ kind: "destroy" })),
      exec: (argv, execOptions = {}) =>
        Effect.suspend(() => {
          calls.push({
            argv,
            kind: "exec",
            network: reach,
            options: execOptions,
          });

          return run(argv);
        }),
      writeFile: (path, bytes) =>
        Effect.suspend(() => {
          calls.push({
            kind: "writeFile",
            path,
            text: new TextDecoder().decode(bytes),
          });

          return options.writeFile?.(path) ?? Effect.void;
        }),
    })
  );

  const network = Layer.succeed(
    Network,
    Network.of({
      allow: (hosts) =>
        Effect.sync(() => {
          reach = [...hosts];
          calls.push({ hosts: [...hosts], kind: "allow" });
        }),
      routeClone: ({ host, remote, token }) =>
        Effect.sync(() =>
          calls.push({
            host,
            kind: "route",
            remote,
            token: Redacted.value(token),
          })
        ),
      routeEnv: ({ hosts, values }) =>
        Effect.sync(() => {
          for (const host of hosts) {
            calls.push({ host, kind: "intercept", values: values.length });
          }
        }),
    })
  );

  const snapshots = Layer.succeed(
    Snapshots,
    Snapshots.of({
      restore: (key) =>
        Effect.sync(() => {
          const hit = kept.has(key);

          calls.push({ hit, key, kind: "restore" });

          return hit;
        }),
      save: (key) =>
        Effect.sync(() => {
          kept.add(key);
          calls.push({ key, kind: "save" });
        }),
    })
  );

  const logs = Layer.succeed(
    CheckLogs,
    CheckLogs.of({
      report: (reported) =>
        Effect.sync(() => calls.push({ kind: "report", logs: reported })),
    })
  );

  const logger = Logger.layer([
    Logger.make(({ fiber, logLevel, message }) => {
      const annotations = fiber.getRef(References.CurrentLogAnnotations);

      calls.push({
        annotations: Object.fromEntries(
          Object.entries(annotations).map(([key, value]) => [
            key,
            String(value),
          ])
        ),
        kind: "log",
        level: logLevel,
        // A log line's message is its arguments, one string here.
        message: String(message),
      });
    }),
  ]);

  return {
    calls,
    layer: Layer.mergeAll(box, network, snapshots, logs, logger),
  };
};

/** One thing done to a Durable Object's container, as the Container API saw it. */
export type ContainerCall =
  | {
      readonly kind: "exec";
      readonly argv: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }
  | { readonly kind: "intercept"; readonly target: string; readonly to: string }
  | { readonly kind: "start"; readonly from: string }
  | { readonly kind: "snapshot" }
  | { readonly kind: "destroy" };

const bytes = (text: string) => {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.length);

  new Uint8Array(buffer).set(encoded);

  return buffer;
};

/**
 * A running container as the Container API shows a Durable Object one: it
 * records each call, prints a lockfile listing for `git ls-tree`, and exits
 * 0 with no output for every other command. Its outbound intercepts record
 * which gateway, with which props, took each target.
 */
export const fakeContainer = () => {
  const calls: ContainerCall[] = [];
  const gateways = new Map<Fetcher, string>();

  const gateway = (description: string) => {
    const fetcher = untouchable<Fetcher>(description);

    gateways.set(fetcher, description);

    return fetcher;
  };

  const container = untouchable<Container>("container", {
    destroy: () => {
      calls.push({ kind: "destroy" });

      return Promise.resolve();
    },
    exec: (argv, options = {}) => {
      calls.push({ argv, env: options.env ?? {}, kind: "exec" });

      const stdout = argv.includes("ls-tree") ? LOCKFILES : "";

      return Promise.resolve(
        untouchable<ExecProcess>("process", {
          output: () =>
            Promise.resolve({
              exitCode: 0,
              stderr: bytes(""),
              stdout: bytes(stdout),
            }),
        })
      );
    },
    images: { check: "registry.cloudflare.com/sandbox/check:315" },
    interceptAllOutboundHttp: (binding) => {
      calls.push({
        kind: "intercept",
        target: "http:*",
        to: gateways.get(binding) ?? "?",
      });

      return Promise.resolve();
    },
    interceptOutboundHttps: (target, binding) => {
      calls.push({
        kind: "intercept",
        target,
        to: gateways.get(binding) ?? "?",
      });

      return Promise.resolve();
    },
    running: true,
    snapshotContainer: () => {
      calls.push({ kind: "snapshot" });

      return Promise.resolve({ id: "snapshot-1", size: 1 });
    },
    start: (options) => {
      calls.push({
        from: options?.containerSnapshot?.id ?? options?.image ?? "?",
        kind: "start",
      });
    },
  });

  /** The loopbacks `ctx.exports` holds for the Worker's outbound gateways. */
  const exports = {
    CloneGateway: ({ props }: { readonly props: CloneProps }) =>
      gateway(`clone ${props.remote} ${props.token}`),
    EgressGateway: ({ props }: { readonly props: EgressProps }) =>
      gateway(`egress [${props.allow.join(" ")}]`),
    // Says how many values the props hold, never which.
    EnvGateway: ({ props }: { readonly props: EnvGatewayProps }) =>
      gateway(
        `env [${props.rules.map(({ host }) => host).join(" ")}] ${props.values.length} values`
      ),
  };

  return { calls, container, exports };
};
