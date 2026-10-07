import { Brand } from "@repo/brand";
import { CreditRole } from "@repo/protocol/domain/credit";
import type { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import { Handle } from "@repo/protocol/ids";
import type {
  AskId,
  CheckVersion,
  PatchId,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { Array, Option, Order, Schema } from "effect";

/** One `Key: value` line of a commit message's trailer block. */
export interface Trailer {
  readonly key: string;
  readonly value: string;
}

/** A git identity: the name and email of an author or committer line. */
export interface Person {
  readonly name: string;
  readonly email: string;
}

/** The accountable person, as a landing's author: their handle at the platform's users domain. */
export const authorLine = (handle: Handle): Person => ({
  email: `${handle}@users.${Brand.domain}`,
  name: handle,
});

/** The platform, which commits every landing. */
export const committerLine: Person = {
  email: `platform@${Brand.domain}`,
  name: Brand.name,
};

/** What a landing commit's message is made of; every trailer comes from the platform's own rows. */
export interface LandingMessage {
  readonly subject: string;
  readonly body?: string;
  readonly credits: readonly Credit[];
  /** The agents people worked through: a disclosure, never credit. */
  readonly assisted: readonly AgentTrailer[];
  readonly ask?: { readonly project: ProjectName; readonly ask: AskId };
  readonly verdict?: {
    readonly patchId: PatchId;
    readonly checkVersion: CheckVersion;
  };
  /** The `Held-back:` value, such as `export 7/7 @ sha256:…`, without its key. */
  readonly heldBack?: string;
  readonly requestId?: RequestId;
}

const ASSISTED = "Assisted-by";

/** One line, so no value or subject can open a paragraph or a trailer of its own. */
const oneLine = (text: string) => text.replaceAll(/\s+/gu, " ").trim();

const personOf = (handle: Handle) => {
  const { email, name } = authorLine(handle);

  return `${name} <${email}>`;
};

// The kernel's `AGENT:MODEL` shape, then whether the platform confirmed it:
// `claude-code:opus-4 (verified)`. A harness name holds no colon.
const agentOf = ({ harness, model, verified }: AgentTrailer) =>
  `${oneLine(harness)}${model === undefined ? "" : `:${oneLine(model)}`} (${verified ? "verified" : "claimed"})`;

const roleOrder = (role: CreditRole) => CreditRole.literals.indexOf(role);

/**
 * Credits in the order of `CreditRole`, people within a role in the order
 * given, each (role, person) once: the same rows always make the same message.
 */
const ordered = (credits: readonly Credit[]) =>
  Array.dedupeWith(
    Array.sortWith(credits, ({ role }) => roleOrder(role), Order.Number),
    (one: Credit, other: Credit) =>
      one.role === other.role && one.handle === other.handle
  );

/**
 * A landing commit's message: the subject, the body, then one trailer block
 * that credits each person by role, discloses each agent as `Assisted-by`,
 * and cites the ask, the verdict, the held-back result and the request.
 */
export const formatLanding = (input: LandingMessage): string => {
  const trailers: readonly Trailer[] = [
    ...ordered(input.credits).map(({ handle, role }) => ({
      key: role,
      value: personOf(handle),
    })),
    ...input.assisted.map((agent) => ({
      key: ASSISTED,
      value: agentOf(agent),
    })),
    ...(input.ask === undefined
      ? []
      : [{ key: "Ask", value: `${input.ask.project}/${input.ask.ask}` }]),
    ...(input.verdict === undefined
      ? []
      : [
          {
            key: "Verdict",
            value: `${input.verdict.patchId} ${oneLine(input.verdict.checkVersion)}`,
          },
        ]),
    ...(input.heldBack === undefined
      ? []
      : [{ key: "Held-back", value: oneLine(input.heldBack) }]),
    ...(input.requestId === undefined
      ? []
      : [{ key: "Request-id", value: input.requestId }]),
  ];

  const body = input.body?.trim() ?? "";

  const paragraphs = [
    oneLine(input.subject),
    ...(body === "" ? [] : [body]),
    ...(trailers.length === 0
      ? []
      : [trailers.map(({ key, value }) => `${key}: ${value}`).join("\n")]),
  ];

  return `${paragraphs.join("\n\n")}\n`;
};

// C's `isspace`, which git's trailer code tests with.
const SPACE = /^[ \t\n\v\f\r]/u;

const isSpace = (text: string) => SPACE.test(text);

const isBlank = (line: string) => /^[ \t\n\v\f\r]*$/u.test(line);

const isComment = (line: string) => line.startsWith("#");

// Lines git counts as trailers whatever the rest of the paragraph holds.
const GIT_GENERATED = ["Signed-off-by: ", "(cherry picked from commit "];

/**
 * Where a trailer's key ends: letters, digits and dashes, then optional
 * blanks, then `:`. `-1` when the line has no key (git's `find_separator`).
 */
const separatorOf = (line: string) => {
  let blank = false;

  for (let at = 0; at < line.length; at += 1) {
    const char = line.charAt(at);

    if (char === ":") {
      return at;
    }

    if (!blank && /^[A-Za-z0-9-]$/u.test(char)) {
      continue;
    }

    if (at > 0 && (char === " " || char === "\t")) {
      blank = true;
      continue;
    }

    break;
  }

  return -1;
};

/** The message's lines up to a `---` divider, less trailing comments and empty lines. */
const logLines = (message: string) => {
  const lines = message.split("\n");
  const ended = message.endsWith("\n");

  if (ended) {
    lines.pop();
  }

  const divider = lines.findIndex(
    (line, at) =>
      line.startsWith("---") &&
      (line.length > 3
        ? isSpace(line.slice(3))
        : at < lines.length - 1 || ended)
  );

  const kept = divider === -1 ? lines : lines.slice(0, divider);
  let end = kept.length;

  while (end > 0 && (kept[end - 1] === "" || isComment(kept[end - 1] ?? ""))) {
    end -= 1;
  }

  return kept.slice(0, end);
};

/**
 * Where the trailer block starts, by git's rule: the last paragraph after
 * the title, if all its lines are trailers, or if one is a sign-off and at
 * least a quarter are trailers.
 */
const blockStart = (lines: readonly string[]): Option.Option<number> => {
  const titleEnd = lines.findIndex((line) => !isComment(line) && isBlank(line));

  if (titleEnd === -1) {
    return Option.none();
  }

  let onlySpaces = true;
  let recognized = false;
  let trailerLines = 0;
  let otherLines = 0;
  let continuations = 0;

  for (let at = lines.length - 1; at >= titleEnd; at -= 1) {
    const line = lines[at] ?? "";

    if (isComment(line)) {
      otherLines += continuations;
      continuations = 0;
    } else if (isBlank(line)) {
      if (!onlySpaces) {
        otherLines += continuations;

        return (recognized && trailerLines * 3 >= otherLines) ||
          (trailerLines > 0 && otherLines === 0)
          ? Option.some(at + 1)
          : Option.none();
      }
    } else {
      onlySpaces = false;

      if (GIT_GENERATED.some((prefix) => line.startsWith(prefix))) {
        trailerLines += 1;
        continuations = 0;
        recognized = true;
      } else if (separatorOf(line) >= 1 && !isSpace(line)) {
        trailerLines += 1;
        continuations = 0;
      } else if (isSpace(line)) {
        continuations += 1;
      } else {
        otherLines += 1 + continuations;
        continuations = 0;
      }
    }
  }

  return Option.none();
};

/** A value with its continuation lines folded to single spaces. */
const unfold = (value: string) =>
  value
    .replaceAll(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/gu, "")
    .replaceAll(/\n[ \t\n\v\f\r]*/gu, " ")
    .replaceAll(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/gu, "");

/**
 * A message's trailers in order, as `git interpret-trailers --parse` reads
 * them: keys and values trimmed, continuation lines unfolded, lines that are
 * not trailers left out.
 */
export const parseTrailers = (message: string): readonly Trailer[] => {
  const lines = logLines(message);

  return Option.match(blockStart(lines), {
    onNone: () => [],
    onSome: (start) => {
      // Each item is one trailer with its continuation lines, or another line.
      const items: string[] = [];
      let open = false;

      for (const line of lines.slice(start)) {
        if (open && isSpace(line)) {
          items.push(`${items.pop() ?? ""}\n${line}`);
        } else {
          items.push(line);
          open = separatorOf(line) >= 1;
        }
      }

      return items.flatMap((item) => {
        const cut = separatorOf(item);

        return isComment(item) || cut < 1
          ? []
          : [
              {
                key: item.slice(0, cut).trim(),
                value: unfold(item.slice(cut + 1)),
              },
            ];
      });
    },
  });
};

const escaped = (text: string) =>
  text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);

// Exactly what `personOf` writes: a handle at the platform's users domain.
const PERSON = new RegExp(
  `^(?<handle>[A-Za-z0-9][A-Za-z0-9-]*) <\\k<handle>@users\\.${escaped(Brand.domain)}>$`,
  "u"
);

const AGENT =
  /^(?<harness>[^:]+?)(?::(?<model>.+))? \((?<mark>claimed|verified)\)$/u;

const decodeRole = Schema.decodeUnknownOption(CreditRole);

const decodeHandle = Schema.decodeUnknownOption(Handle);

const creditOf = ({ key, value }: Trailer): Option.Option<Credit> =>
  Option.gen(function* () {
    const role = yield* decodeRole(
      CreditRole.literals.find(
        (literal) => literal.toLowerCase() === key.toLowerCase()
      )
    );

    const handle = yield* decodeHandle(PERSON.exec(value)?.groups?.handle);

    return { handle, role };
  });

const agentFrom = ({ key, value }: Trailer): Option.Option<AgentTrailer> => {
  const groups = AGENT.exec(value)?.groups;

  if (key.toLowerCase() !== ASSISTED.toLowerCase() || groups === undefined) {
    return Option.none();
  }

  const harness = groups.harness ?? "";
  const { model } = groups;
  const verified = groups.mark === "verified";

  return Option.some(
    model === undefined ? { harness, verified } : { harness, model, verified }
  );
};

/** The people a landing credits, and the agents it discloses. */
export interface LandingCredits {
  readonly credits: readonly Credit[];
  readonly assisted: readonly AgentTrailer[];
}

/**
 * Who a landing credits, and which agents it discloses. Only trailers the
 * platform writes count: a credit names a platform handle by `authorLine`,
 * and `Assisted-by` is never credit.
 */
export const creditsOf = (message: string): LandingCredits => {
  const trailers = parseTrailers(message);

  return {
    assisted: Array.getSomes(trailers.map(agentFrom)),
    credits: Array.getSomes(trailers.map(creditOf)),
  };
};
