import { Brand } from "@repo/brand";
import { RatchetMeasure } from "@repo/protocol/domain/check";
import type { AskKind, CheckKind, ClaimRule } from "@repo/protocol/domain/kind";
import type { Policy } from "@repo/protocol/domain/policy";
import type { RunBlock } from "@repo/protocol/domain/run";
import { Array as Arr, Order, Predicate } from "effect";

import { pushCommand } from "./install.ts";
import { code, listed, table } from "./text.ts";

const cli = (...words: readonly string[]) =>
  code([Brand.cli, ...words].join(" "));

const remote = Brand.slug;

const notesRef = `refs/notes/${Brand.slug}`;

export const loopSteps = () => [
  `1. Read the ask, then claim it: ${cli("ask", "<ask>")}, then ${cli("claim", "<ask>")}. The claim prints your fork's remote; add it with ${code(`git remote add ${remote} <remote>`)}.`,
  "2. Work inside the ask's territory until its check passes.",
  `3. Run ${cli("check")}. It gives the refusals a push would get, then runs the ask's check and the project's lanes; fix everything it reports.`,
  `4. Push your answer to your fork: ${code(pushCommand)}. The push itself can be refused, on git's \`remote:\` lines.`,
  `5. Wait for the verdict: the rest of the checks run on the platform after git returns. Run ${cli("status", "--json")} until your answer's \`outcome._tag\` is no longer \`Checking\`, then read the verdict on your head: ${code(`git fetch ${remote} ${notesRef}:${notesRef}`)}, then ${code(`git notes --ref=${Brand.slug} show HEAD`)}. It is JSON: match on its \`_tag\`, and run a refusal's \`next\`.`,
];

const unitsOfTime = [
  { ms: 86_400_000 * 7, one: "week" },
  { ms: 86_400_000, one: "day" },
  { ms: 3_600_000, one: "hour" },
  { ms: 60_000, one: "minute" },
  { ms: 1000, one: "second" },
] as const;

export const span = (ms: number) => {
  const unit = unitsOfTime.find((each) => ms % each.ms === 0) ?? unitsOfTime[4];

  const count = Math.round(ms / unit.ms);

  return `${count} ${unit.one}${count === 1 ? "" : "s"}`;
};

export const claimTerms = (policy: Policy) =>
  `A claim stays alive only while you push to it: after ${span(policy.claims.warnAfterMs)} without a push it is warned, and after ${span(policy.claims.lapseAfterMs)} it lapses. You may hold ${policy.caps.claimsPerPerson} ${policy.caps.claimsPerPerson === 1 ? "claim" : "claims"} at once in this project.`;

const byName = <A>(name: (item: A) => string) =>
  Order.mapInput(Order.String, name);

const judgeLines = (judge: Policy["judge"]) => [
  ...judge.paths.map((path) => `- ${code(path)}`),
  ...judge.pointers.map(
    (pointer) => `- ${code(pointer)} (only that part of the file)`
  ),
];

const measureOf = RatchetMeasure.match({
  Count: ({ command, rule }) =>
    rule === undefined
      ? `the lint findings ${code(command)} prints`
      : `the ${code(rule)} findings ${code(command)} prints`,
  Metric: ({ command, path }) =>
    `the number at ${code(path)} in the JSON ${code(command)} prints`,
});

const ratchetLines = (ratchets: Policy["ratchets"]) =>
  Arr.sort(
    ratchets,
    byName((ratchet: Policy["ratchets"][number]) => ratchet.name)
  ).map(
    (ratchet) =>
      `- ${code(ratchet.name)}${ratchet.territory === undefined ? "" : ` in ${code(ratchet.territory)}`}: ${measureOf(ratchet.measure)}`
  );

export const changeSection = (policy: Policy) => {
  const { judge, modules, ratchets, weakening } = policy;

  const publicFiles = modules.some(
    ({ publicFiles: files }) => files !== undefined
  );

  const territories = Arr.sort(
    modules,
    byName((module: Policy["modules"][number]) => module.module)
  );

  return [
    "## What an answer may change",
    "",
    `Change files only inside the ask's territory, the module ${cli("ask", "<ask>")} names; a push that changes anything else is refused with \`OutOfScope\`.`,
    ...(territories.length === 0
      ? []
      : [
          "",
          ...table(
            ["Module", "Paths", "Public files"],
            territories.map((module) => [
              code(module.module),
              module.paths.map(code).join(", "),
              module.publicFiles === undefined
                ? "every file"
                : module.publicFiles.map(code).join(", "),
            ])
          ),
        ]),
    ...(publicFiles
      ? [
          "",
          "Import another module only through its public files; an import that reaches past them is refused with `ReachedInternals`.",
        ]
      : []),
    ...(judge.paths.length + judge.pointers.length === 0
      ? []
      : [
          "",
          "Never change the judge closure, the files that decide what the checks do; a push that changes one is refused with `TouchedJudge`:",
          "",
          ...judgeLines(judge),
        ]),
    ...(weakening.markers.length === 0
      ? []
      : [
          "",
          `Never add a marker that turns a check off: ${weakening.markers.map(code).join(", ")}. One without a reason is refused with \`Weakened\`; one with a reason waits for a maintainer.`,
        ]),
    ...(ratchets.length === 0
      ? []
      : [
          "",
          "Ratchets only go down: an answer that raises one is refused with `Weakened`, and only a maintainer raises one.",
          "",
          ...ratchetLines(ratchets),
        ]),
    "",
  ];
};

export const lanesOf = (run: RunBlock) =>
  Arr.sort(
    Object.entries(run.checks),
    byName(([lane]: readonly [string, string]) => lane)
  );

export const runSection = (run: RunBlock) => [
  "## The run block",
  "",
  `The project's own commands. The platform runs them exactly as written, on the merged tree, in the ${code(run.image ?? "checker:default")} image; ${cli("check")} runs them on your machine.`,
  "",
  ...(run.setup === undefined ? [] : [`- Setup, once: ${code(run.setup)}`]),
  ...(run.setupEgress === undefined || run.setupEgress.length === 0
    ? []
    : [
        `- Setup may reach ${run.setupEgress.map(code).join(", ")}; the checks reach no network.`,
      ]),
  ...(run.doctor === undefined ? [] : [`- Doctor: ${code(run.doctor)}`]),
  `- One check file: ${code(run.test)}, with \`{path}\` the ask's check file`,
  "- Lanes, each run on every answer:",
  ...lanesOf(run).map(
    ([lane, command]) => `  - ${code(lane)}: ${code(command)}`
  ),
  "",
];

const checkKindText = (kind: CheckKind, run: RunBlock) =>
  ({
    lintToZero:
      "a lint rule's findings in the territory go to zero; the ask names the rule and the command that counts them.",
    migrate:
      "every use of one name moves to another; the ask names the command that counts the uses left.",
    ratchet: "a named ratchet goes down; the ask names it.",
    redThenGreen: `one check file fails on main by an assertion, and passes with your answer; ${cli("check")} runs it with ${code(run.test)}.`,
    symbolAbsent:
      "the last step of a migrate: a name is gone; the ask names the command that counts its uses.",
  })[kind];

const claimerText = (rule: ClaimRule, vouchFile: string) => {
  if (Predicate.isString(rule)) {
    return rule === "anyone"
      ? "anyone signed in."
      : `anyone a member has vouched for in ${code(vouchFile)}.`;
  }

  return "record" in rule
    ? `anyone whose record has at least ${rule.record.atLeast} ${rule.record.atLeast === 1 ? "landing" : "landings"} in ${code(rule.record.area)}.`
    : `a newcomer, with ${code(rule.newcomer.mentor)} as mentor.`;
};

const finishText = {
  never: "none: a passing answer lands as it is.",
  optional:
    "a maintainer may add commits of their own to a passing answer before it lands, credited `Finished-by`.",
  required:
    "a passing answer waits for a maintainer's commits on top before it lands, credited `Finished-by`.",
} as const satisfies Record<AskKind["finish"], string>;

const kindLines = (kind: AskKind, policy: Policy) => [
  `### ${code(kind.name)}`,
  "",
  `- Check: ${checkKindText(kind.checkKind, policy.run)}`,
  `- Who may claim: ${claimerText(kind.claimers, policy.vouch.file)}`,
  kind.race === 1
    ? "- Claims at once: 1; the claim is exclusive."
    : `- Claims at once: up to ${kind.race}.`,
  `- Finish: ${finishText[kind.finish]}`,
  ...(kind.oneWay ? ["- One way: a later answer can't undo its answers."] : []),
  ...(kind.requires.length === 0
    ? []
    : [`- The brief states: ${listed(kind.requires)}.`]),
  "",
];

export const kindsSection = (policy: Policy) =>
  policy.kinds.length === 0
    ? []
    : [
        "## Ask kinds",
        "",
        `Each ask is of one kind, which says how its check judges an answer, who may claim it and whether a maintainer finishes it; ${cli("ask", "<ask>")} names it.`,
        "",
        ...Arr.sort(
          policy.kinds,
          byName((kind: AskKind) => kind.name)
        ).flatMap((kind) => kindLines(kind, policy)),
      ];

export const unfencedNorms = (agents: Policy["agents"] = "trailer") => [
  "- Keep an answer to its ask's want. The gate holds the files you change to the territory, but nothing measures how much you change inside it.",
  ...(agents === "none"
    ? []
    : [
        "- Name the agent you work through. A landing carries an `Assisted-by:` trailer for the agent your harness's environment names; a harness that names none goes unnamed.",
      ]),
];

export const unfencedSection = (agents: Policy["agents"] = "trailer") => [
  "## No fence yet",
  "",
  "Norms that nothing checks yet. Keep them; the gate does not refuse an answer that breaks one.",
  "",
  ...unfencedNorms(agents),
  "",
];
