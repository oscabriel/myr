// A stage's alerts, as data: Cloudflare Custom Alerts (beta), each a SQL API
// query run on a schedule and judged by a threshold or an anomaly. A person
// makes them by hand: the Notifications API lists the `custom_analytics`
// alert type but documents none of its fields, and nothing in cf or the API
// takes a custom alert's query, so bootstrap prints each for the dashboard
// (README, Alerts), makes none, and records none in the ledger. Every query
// counts rows by Worker; none reads a log's text, a path or a layer
// (principle 7).
import { Data, Duration } from "effect";

import { ERRORED, quoted, workersOf } from "./logs.ts";
import { resources } from "./stages.ts";
import type { Stage } from "./stages.ts";

export type Detection = Data.TaggedEnum<{
  // The query's value over the evaluation window reaches `atLeast`.
  Threshold: { readonly atLeast: number };
  // The value is `sensitivity` standard deviations above the baseline
  // window's, and at least `minimum`: a spike, never a drop.
  Spike: {
    readonly baseline: Duration.Duration;
    readonly sensitivity: number;
    readonly minimum: number;
  };
}>;

export const Detection = Data.taggedEnum<Detection>();

export const alertKinds = [
  "errors",
  "issue spike",
  "container failures",
  "refusal spike",
] as const;

export interface Alert {
  readonly kind: (typeof alertKinds)[number];
  readonly name: string;
  // One numeric column named `value`, and no time filter: the alert's
  // Automatic time range is its evaluation window.
  readonly query: string;
  readonly window: Duration.Duration;
  readonly detection: Detection;
}

// What the apps log at error level when a sandbox job's container never
// answered: the platform when a job comes back blocked, and the sandbox when
// a Checker can't be reached. `alerts.test.ts` holds each to its source.
export const CONTAINER_FAILURES = [
  "sandbox job blocked",
  "the Checker could not be reached",
] as const;

// The metrics dataset's layout, as the platform's writer
// (`packages/project/src/metrics/binding.ts`) lays it out: its first blob is
// the point's kind, `Refused` for one refusal. `alerts.test.ts` holds it to
// the writer.
export const REFUSED = "blob1 = 'Refused'";

const within = (column: string, values: readonly string[]) =>
  `${column} IN (${values.map(quoted).join(", ")})`;

export const alerts = (stage: Stage, account: string): readonly Alert[] => {
  const { metrics, platform, sandbox } = resources(stage);
  // A custom alert's SQL names its account. Smoke's names none: the SQL API
  // refuses a query that names one beside the request's own scope.
  const scoped = `accountTag = ${quoted(account)}`;

  const failed = CONTAINER_FAILURES.map(
    (line) => `message LIKE ${quoted(`%${line}%`)}`
  ).join(" OR ");

  return [
    ...workersOf(stage).map((worker): Alert => ({
      detection: Detection.Threshold({ atLeast: 5 }),
      kind: "errors",
      name: `${worker} errors`,
      query: `SELECT count() AS value FROM logs.workersLogs WHERE ${scoped} AND scriptName = ${quoted(worker)} AND ${ERRORED}`,
      window: Duration.minutes(15),
    })),
    {
      detection: Detection.Spike({
        baseline: Duration.hours(2),
        minimum: 3,
        sensitivity: 3,
      }),
      kind: "issue spike",
      name: `${stage} issue spike`,
      query: `SELECT count() AS value FROM logs.issues WHERE ${scoped} AND ${within("scriptName", workersOf(stage))}`,
      window: Duration.minutes(10),
    },
    {
      detection: Detection.Threshold({ atLeast: 3 }),
      kind: "container failures",
      name: `${stage} container failures`,
      query: `SELECT count() AS value FROM logs.workersLogs WHERE ${scoped} AND ${within("scriptName", [platform, sandbox])} AND level = 'error' AND (${failed})`,
      window: Duration.minutes(30),
    },
    {
      detection: Detection.Spike({
        baseline: Duration.hours(6),
        minimum: 5,
        sensitivity: 3,
      }),
      kind: "refusal spike",
      name: `${stage} refusal spike`,
      query: `SELECT count() AS value FROM events.analyticsEngine."${metrics}" WHERE ${scoped} AND ${REFUSED}`,
      window: Duration.minutes(15),
    },
  ];
};

const detected = ({ detection, window }: Alert) =>
  Detection.$match(detection, {
    Spike: ({ baseline, minimum, sensitivity }) =>
      `anomaly detection on spikes, evaluation window ${Duration.format(window)}, baseline window ${Duration.format(baseline)}, sensitivity ${sensitivity}, minimum event count ${minimum}`,
    Threshold: ({ atLeast }) =>
      `threshold, value >= ${atLeast}, evaluation window ${Duration.format(window)}`,
  });

// The destination is named, never shown: `addressed` says whether infra's
// env sets it.
export const alertLines = (
  stage: Stage,
  all: readonly Alert[],
  addressed: boolean
): readonly string[] => [
  `bootstrap ${stage}: make these ${all.length} alerts by hand, as Custom Alerts in the dashboard: no API takes a custom alert's query yet (README, Alerts)`,
  `bootstrap ${stage}: each is custom SQL with an Automatic time range, sent to ${
    addressed
      ? "ALERT_EMAIL's address"
      : "ALERT_EMAIL's address, which infra/.env.local does not set yet"
  }`,
  ...all.flatMap((alert) => [
    `  ${alert.name}: ${detected(alert)}`,
    `    ${alert.query}`,
  ]),
];
