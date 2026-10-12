// The policy digest reads only a `PublicPolicy`'s kinds, modules, run block
// and deciders, so no layer, held-back check or reason can reach a prompt.
import { Brand } from "@repo/brand";
import type { PublicPolicy } from "@repo/protocol/domain/policy";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Option } from "effect";

import type { DraftInput } from "./drafted.ts";

const tailBytes = 4 * 1024;

export interface Feedback {
  readonly diagnosis: string;
  readonly excerpt: string;
  readonly refusal: Refusal;
}

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

export const feedbackText = (feedback: Feedback): string =>
  [
    ...explain([feedback.refusal]),
    `diagnosis: ${feedback.diagnosis}`,
    "output (its end):",
    tailOf(feedback.excerpt),
  ].join("\n");

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
