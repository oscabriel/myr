/**
 * Verdict notes on an answer's fork (spec D22, §5 steps 7 and 10): after the
 * platform judges an answer, its answerer reads the verdict with plain git,
 *
 *     git fetch origin refs/notes/<slug>:refs/notes/<slug>
 *     git notes --ref=<slug> show <head>
 *
 * in a clone of their fork. One JSON note per head, the public `Verdict`
 * encoding and nothing more (D17); a newer verdict on the same head
 * replaces its note, and the notes on the fork's other heads stay.
 *
 * Everything goes through `RepoHost` (principle 6): the notes ref's tip from
 * the ref listing (the binding resolves no custom ref, S1 #20), the earlier
 * notes through reads, and the new note as one compare-and-swap push of the
 * notes ref alone, never beside a branch (no atomic multi-ref push, S1 #6),
 * never forced. Each new notes commit has the earlier one as its parent, so
 * the same fetch, without `+`, brings the newer note to a clone that has the
 * older. The canonical notes on landings are the Lander's (W2 212).
 */
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

/** What writing a note came to: the notes ref's tip, and whether the write moved it. */
export interface NoteWritten {
  readonly notesTip: CommitSha;
  readonly changed: boolean;
}

const encoder = new TextEncoder();

const encodeVerdict = Schema.encodeEffect(Schema.fromJsonString(Verdict));

/** The note's bytes as `noteCommit` writes them: the verdict's JSON and a newline. */
const noteBytes = (verdict: Verdict) =>
  Effect.map(Effect.orDie(encodeVerdict(verdict)), (json) =>
    encoder.encode(`${json}\n`)
  );

/** The id git gives a blob holding `bytes`. */
const blobId = (bytes: Uint8Array) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest(
        "SHA-1",
        Uint8Array.from([
          ...encoder.encode(`blob ${bytes.byteLength}\0`),
          ...bytes,
        ])
      )
    ),
    (digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
  );

/** git's zlib stream, as a loose object holds it. */
const deflate = (bytes: Uint8Array) =>
  Effect.map(
    Effect.promise(() =>
      new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"))
      ).arrayBuffer()
    ),
    (buffer) => new Uint8Array(buffer)
  );

/**
 * The earlier note `blob` in the fork, put in `source` as a loose object.
 * A push over git smart HTTP (`/binding`'s) sends every object the new
 * notes tree names that it cannot tell the remote has, and the source
 * holds no earlier notes commit to tell it by, so it must hold their blobs.
 */
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

    const loose = yield* deflate(
      Uint8Array.from([
        ...encoder.encode(`blob ${bytes.byteLength}\0`),
        ...bytes,
      ])
    );

    // Another note's blob may have made the folder already.
    yield* Effect.ignore(
      Effect.tryPromise(() => source.fs.promises.mkdir(dir))
    );
    yield* Effect.promise(() =>
      source.fs.promises.writeFile(`${dir}/${blob.slice(2)}`, loose)
    );
  });

/** The notes tree's entries at `tip`, read through the port; none before the first note. */
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

/**
 * One try: the note on top of the notes ref as listed now, pushed with a
 * compare-and-swap on that ref alone. `None` when the ref moved under it.
 */
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

/**
 * `verdict` as the note on `head` in `fork`. The same verdict already there
 * changes nothing (`changed: false`, no push). A notes ref that moved
 * between the listing and the push is listed again and the note written on
 * top of the move, once; one that moved under that too is `HostBusy`, for
 * the caller to retry.
 */
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
