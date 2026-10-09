/**
 * What the platform's agent is told. The system prompt holds the rules of a
 * good draft and a digest of the project's public policy; the user prompt
 * holds the want, the files picked for it and, from attempt 2 on, what went
 * wrong with the last attempt.
 *
 * The digest is built from a `PublicPolicy`, and reads only its kinds,
 * modules, run block and deciders, so no layer, held-back check or reason
 * from `visibility` can reach a prompt. The product's name comes from
 * `Brand`.
 */
import { Brand } from "@repo/brand";
import type { PublicPolicy } from "@repo/protocol/domain/policy";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Option } from "effect";

import type { DraftInput } from "./drafted.ts";

/** The most of a failing run's output an attempt is shown: its last 4 KB. */
const tailBytes = 4 * 1024;

/** Why the last attempt's draft did not open: the gate's refusal, its diagnosis and the run's output. */
export interface Feedback {
  /** The red-first diagnosis: `Passed`, `LoadError`, `Weak` and the like. */
  readonly diagnosis: string;
  /** The failing run's output; only its tail is shown. */
  readonly excerpt: string;
  readonly refusal: Refusal;
}

/**
 * The project's public policy, as the system prompt states it: its ask
 * kinds, its modules, its run block, its deciders, and the folder its ask
 * tests sit in (from the picked style example, `askTestFolderOf`).
 */
export const policyDigest = (
  policy: PublicPolicy,
  askTests: Option.Option<string>
): string =>
  [
    `Ask kinds: ${policy.kinds.map(({ checkKind, name }) => `${name} (${checkKind})`).join(", ")}.`,
    `Run one test file with: ${policy.run.test}`,
    ...Object.entries(policy.run.checks).map(
      ([lane, command]) => `Check lane ${lane}: ${command}`
    ),
    ...policy.modules.map(
      ({ module, paths }) => `Module ${module}: ${paths.join(", ")}`
    ),
    ...policy.deciders.map(
      ({ handles, paths }) => `Deciders for ${paths}: ${handles.join(", ")}`
    ),
    Option.match(askTests, {
      onNone: () =>
        "Ask tests: no ask exists yet; put the test beside the project's other tests.",
      onSome: (folder) => `Ask tests go in: ${folder}/`,
    }),
  ].join("\n");

/** The rules of a draft, then the project's policy digest. */
export const systemPrompt = (digest: string): string =>
  [
    `You draft one ask for a project hosted on ${Brand.name}. An ask is a file in which a project states one change it wants: a behavioural want, a territory, and a test that fails on main today.`,
    "",
    "Return only JSON that matches the given schema. Its fields:",
    "- id: a short kebab-case name for the ask.",
    '- kind: always "fix".',
    "- want: one testable sentence saying how the code should behave. It names no file and no line.",
    "- current: what happens on main today, when it helps.",
    "- outOfScope: what an answer should leave alone, when it helps.",
    "- context: facts an answerer needs that the code does not say, when they help.",
    "- territory: the smallest set of existing files an answer must change.",
    "- test.path and test.source: the ask's test file.",
    "- rationale: why this draft reads the want this way, for the decider.",
    "",
    "Rules for the test:",
    "- It must fail on the current code by an assertion (an expect that fails), never by a missing import, export or file.",
    "- Import only symbols that exist in the files you were shown.",
    "- Keep it deterministic: no network, no clock (use fixed dates), no randomness.",
    "- Put it in the project's ask-test folder, named after the ask's id.",
    "- Write no other file.",
    "",
    "The project:",
    digest,
  ].join("\n");

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/** The last `tailBytes` of a run's output, starting on a whole line where one fits. */
const tailOf = (output: string) => {
  const bytes = encoder.encode(output);

  if (bytes.length <= tailBytes) {
    return output;
  }

  const tail = decoder
    .decode(bytes.slice(bytes.length - tailBytes))
    .replace(/^�/u, "");

  return tail.includes("\n") ? tail.slice(tail.indexOf("\n") + 1) : tail;
};

/**
 * The last attempt's failure as the next one reads it: the refusal as
 * `protocol/render` gives it, the diagnosis, and the output's tail.
 */
export const feedbackText = (feedback: Feedback): string =>
  [
    ...explain([feedback.refusal]),
    `diagnosis: ${feedback.diagnosis}`,
    "output (its end):",
    tailOf(feedback.excerpt),
  ].join("\n");

/** One attempt's question: the want, what to change, the files, and the last failure. */
export const userPrompt = (input: DraftInput): string =>
  [
    `Project: ${input.context.project}, at ${input.context.at}.`,
    `Want: ${input.want}`,
    ...(input.territory === undefined
      ? []
      : [`The person who asked named these paths: ${input.territory}`]),
    ...(input.note === undefined
      ? []
      : [`A note for this draft: ${input.note}`]),
    "",
    "Files from the project:",
    ...input.context.files.flatMap(({ content, path }) => [
      `--- ${path} ---`,
      content,
      `--- end of ${path} ---`,
    ]),
    ...(input.feedback === undefined
      ? []
      : [
          "",
          `Attempt ${input.attempt - 1} was refused. Fix what this says, and keep the rest:`,
          input.feedback,
        ]),
  ].join("\n");
