/**
 * The CLI's process entry: `program` over the arguments the process was
 * started with, on Bun's services, the credentials file and plain output.
 * Tests never import this file; they run `program` with their own services.
 * Issue 416 builds it into the standalone binary.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Client } from "@repo/protocol/contracts";
import { Effect, Layer, Stdio } from "effect";

import { CredentialsFile } from "./credentials.ts";
import { program } from "./main.ts";
import { OutputPlain } from "./output.ts";

/**
 * The platform as the CLI calls it, until issue 404 builds the remote
 * client: every call dies, naming the contract, while commands that never
 * call the platform (help among them) run.
 */
const ClientUnbuilt = Layer.mock(Client)({});

const live = Layer.mergeAll(CredentialsFile, OutputPlain, ClientUnbuilt).pipe(
  Layer.provideMerge(BunServices.layer)
);

BunRuntime.runMain(
  Effect.flatMap(Stdio.Stdio, ({ args }) => args).pipe(
    Effect.flatMap(program),
    Effect.provide(live)
  )
);
