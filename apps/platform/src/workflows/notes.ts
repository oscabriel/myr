import { HostBusy, RefOutcome, RepoHost } from "@repo/artifacts/repo-host";
import type {
  ObjectId,
  RepoName,
  RepoNotFound,
  TreeEntry,
} from "@repo/artifacts/repo-host";
import { noteCommit, notesRef } from "@repo/git/notes";
import type { ScratchSource } from "@repo/git/notes";
import { Verdict } from "@repo/protocol/domain/answer";
import type { CommitSha } from "@repo/protocol/ids";
import { DateTime, Effect, Option, Schema } from "effect";

export { notesRef } from "@repo/git/notes";

export interface NoteWritten {
  readonly notesTip: CommitSha;
  readonly changed: boolean;
}

const encoder = new TextEncoder();

const encodeVerdict = Schema.encodeEffect(Schema.fromJsonString(Verdict));

const noteBytes = (verdict: Verdict) =>
  Effect.map(Effect.orDie(encodeVerdict(verdict)), (json) =>
    encoder.encode(`${json}\n`)
  );

const framed = (bytes: Uint8Array) => {
  const header = encoder.encode(`blob ${bytes.byteLength}\0`);
  const raw = new Uint8Array(header.byteLength + bytes.byteLength);

  raw.set(header);
  raw.set(bytes, header.byteLength);

  return raw;
};

const blobId = (bytes: Uint8Array) =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-1", framed(bytes))),
    (digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
  );

const deflate = (bytes: Uint8Array) =>
  Effect.map(
    Effect.promise(() =>
      new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"))
      ).arrayBuffer()
    ),
    (buffer) => new Uint8Array(buffer)
  );

// A push over smart HTTP sends every object the new notes tree names that it cannot
// tell the remote has, and the source holds no earlier notes commit, so it must hold
// their blobs.
const keepEarlierNote = (
  fork: RepoName,
  source: ScratchSource,
  blob: ObjectId
) =>
  Effect.gen(function* () {
    const bytes = yield* RepoHost.use((host) => host.readBlob(fork, blob)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.die(`${fork} has no note blob ${blob}`),
          onSome: Effect.succeed,
        })
      )
    );

    const dir = `${source.gitdir}/objects/${blob.slice(0, 2)}`;

    const loose = yield* deflate(framed(bytes));

    // Another note's blob may have made the folder already.
    yield* Effect.ignore(
      Effect.tryPromise(() => source.fs.promises.mkdir(dir))
    );
    yield* Effect.promise(() =>
      source.fs.promises.writeFile(`${dir}/${blob.slice(2)}`, loose)
    );
  });

const notesAt = (fork: RepoName, tip: Option.Option<CommitSha>) =>
  Option.match(tip, {
    onNone: () => Effect.succeed<readonly TreeEntry[]>([]),
    onSome: (sha) =>
      Effect.gen(function* () {
        const host = yield* RepoHost;
        const commit = yield* host.readCommit(fork, sha);

        if (Option.isNone(commit)) {
          return yield* Effect.die(`${fork} has no notes commit ${sha}`);
        }

        const tree = yield* host.readTree(fork, commit.value.tree);

        if (Option.isNone(tree)) {
          return yield* Effect.die(`${fork} has no tree ${commit.value.tree}`);
        }

        return tree.value;
      }),
  });

interface NoteInput {
  readonly fork: RepoName;
  readonly head: CommitSha;
  readonly verdict: Verdict;
}

const once = (input: NoteInput) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;

    const tip = Option.fromNullishOr(
      (yield* host.refs(input.fork)).get(notesRef)
    );

    const earlier = yield* notesAt(input.fork, tip);
    const note = yield* blobId(yield* noteBytes(input.verdict));

    if (
      Option.isSome(tip) &&
      earlier.some(({ name, sha }) => name === input.head && sha === note)
    ) {
      return Option.some<NoteWritten>({ changed: false, notesTip: tip.value });
    }

    const { commit, source } = yield* noteCommit({
      notesParent: tip,
      now: yield* DateTime.now,
      repo: input.fork,
      target: input.head,
      verdict: input.verdict,
    });

    yield* Effect.forEach(
      earlier.filter(
        ({ name, type }) => name !== input.head && type === "blob"
      ),
      ({ sha }) => keepEarlierNote(input.fork, source, sha),
      { discard: true }
    );

    const [outcome] = yield* host.push(input.fork, source, [
      { from: tip, ref: notesRef, to: commit },
    ]);

    return outcome !== undefined && RefOutcome.$is("Updated")(outcome)
      ? Option.some<NoteWritten>({ changed: true, notesTip: commit })
      : Option.none();
  });

export const writeVerdictNote = (
  input: NoteInput
): Effect.Effect<NoteWritten, RepoNotFound | HostBusy, RepoHost> =>
  Effect.gen(function* () {
    const first = yield* once(input);

    if (Option.isSome(first)) {
      return first.value;
    }

    const second = yield* once(input);

    if (Option.isSome(second)) {
      return second.value;
    }

    return yield* new HostBusy({ name: input.fork });
  });
