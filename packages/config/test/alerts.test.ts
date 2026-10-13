import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { MetricPoint } from "@repo/project/metrics";
import { dataPointOf } from "@repo/project/metrics/binding";
import { ProjectName } from "@repo/protocol/ids";
import { Duration, Effect, Option } from "effect";

import {
  alertKinds,
  alertLines,
  alerts,
  CONTAINER_FAILURES,
  Detection,
  REFUSED,
} from "../../../infra/alerts.ts";
import type { Alert } from "../../../infra/alerts.ts";
import { ERRORED, errorsQuery, workersOf } from "../../../infra/logs.ts";
import { resources, stages } from "../../../infra/stages.ts";
import { textOf } from "./root.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const everyStage = stages.flatMap((stage) =>
  alerts(stage, ACCOUNT).map((alert) => ({ alert, stage }))
);

// The one dataset a query reads: what follows its `FROM`.
const datasetOf = ({ query }: Alert) =>
  /\bFROM (?<dataset>\S+)/u.exec(query)?.groups?.dataset ?? "";

describe("a stage's alerts", () => {
  it("watch each Worker for errors, and the stage for an issue spike, failing containers and a refusal spike", () => {
    expect(
      alerts("demo", ACCOUNT).map(({ kind, name }) => `${kind}: ${name}`)
    ).toStrictEqual([
      "errors: platform-demo errors",
      "errors: sandbox-demo errors",
      "errors: web-demo errors",
      "issue spike: demo issue spike",
      "container failures: demo container failures",
      "refusal spike: demo refusal spike",
    ]);
    expect(
      stages.map((stage) =>
        [...new Set(alerts(stage, ACCOUNT).map(({ kind }) => kind))].join(",")
      )
    ).toStrictEqual(stages.map(() => alertKinds.join(",")));
  });

  it("ask what a custom alert's SQL must: one numeric `value` from one dataset, the account named, no time filter and no trailing semicolon", () => {
    expect(
      everyStage.flatMap(({ alert, stage }) => {
        const { query } = alert;

        const kept =
          query.startsWith("SELECT count() AS value FROM ") &&
          query.includes(`accountTag = '${ACCOUNT}'`) &&
          !query.includes("timestamp") &&
          !query.trimEnd().endsWith(";") &&
          query.split(/\bFROM\b/u).length === 2;

        return kept ? [] : [`${stage}: ${alert.name}`];
      })
    ).toStrictEqual([]);
  });

  it("read the Workers Logs, Issues and metrics of their own stage alone, never a layer's or another stage's", () => {
    expect(
      everyStage.flatMap(({ alert, stage }) => {
        const others = stages.flatMap((other) =>
          other === stage ? [] : [...workersOf(other), resources(other).metrics]
        );

        // A name in the SQL is a quoted string or a quoted dataset.
        const strays = [resources(stage).layers, ...others].filter(
          (name) =>
            alert.query.includes(`'${name}'`) ||
            alert.query.includes(`"${name}"`)
        );

        return strays.length === 0
          ? []
          : [`${alert.name}: ${strays.join(",")}`];
      })
    ).toStrictEqual([]);
    expect(alerts("prod", ACCOUNT).map(datasetOf)).toStrictEqual([
      "logs.workersLogs",
      "logs.workersLogs",
      "logs.workersLogs",
      "logs.issues",
      "logs.workersLogs",
      'events.analyticsEngine."metrics_prod"',
    ]);
  });

  it("count an error as smoke does: the Worker alerts and smoke's logs check share one predicate", () => {
    const workerAlerts = alerts("dev-oscabriel", ACCOUNT).filter(
      ({ kind }) => kind === "errors"
    );

    expect({
      alerts: workerAlerts.map(({ query }) => query.endsWith(ERRORED)),
      smoke: errorsQuery(workersOf("dev-oscabriel")).includes(ERRORED),
    }).toStrictEqual({ alerts: [true, true, true], smoke: true });
  });

  it("read refusals from the stage's metrics dataset, the one its platform's `METRICS` binding writes", () => {
    expect(
      stages.map((stage) =>
        alerts(stage, ACCOUNT)
          .filter(({ kind }) => kind === "refusal spike")
          .map(datasetOf)
      )
    ).toStrictEqual(
      stages.map((stage) => [
        `events.analyticsEngine."${resources(stage).metrics}"`,
      ])
    );
  });

  it("count a refusal as the platform's writer lays it out: a row whose first blob is a Refused point's kind", () => {
    const { blobs } = dataPointOf(
      MetricPoint.cases.Refused.make({
        project: ProjectName.make("alice/datekit"),
        stage: "shape",
        tag: "OutOfScope",
      })
    );

    expect(REFUSED).toBe(`blob1 = '${blobs[0] ?? ""}'`);
  });

  it("give each anomaly a baseline of at least six windows and at most a day, over a window of at least a minute", () => {
    expect(
      everyStage.flatMap(({ alert }) => {
        const baselined = Detection.$match(alert.detection, {
          Spike: ({ baseline }) =>
            Duration.isGreaterThanOrEqualTo(
              baseline,
              Duration.times(alert.window, 6)
            ) && Duration.isLessThanOrEqualTo(baseline, Duration.hours(24)),
          Threshold: () => true,
        });

        return baselined &&
          Duration.isGreaterThanOrEqualTo(alert.window, Duration.minutes(1))
          ? []
          : [alert.name];
      })
    ).toStrictEqual([]);
  });
});

describe("the container failures they watch for", () => {
  it.effect(
    "are the lines the apps log at error level when a sandbox job's container never answered",
    () =>
      Effect.gen(function* () {
        const sources = yield* Effect.forEach(
          [
            "apps/platform/src/adapters/sandbox-credentials.ts",
            "apps/sandbox/src/checker.ts",
          ],
          textOf
        );

        const text = sources.flatMap(Option.toArray).join("\n");

        expect(
          CONTAINER_FAILURES.map((line) => ({
            line,
            logged: text.includes(`Effect.logError("${line}")`),
          }))
        ).toStrictEqual(
          CONTAINER_FAILURES.map((line) => ({ line, logged: true }))
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("what bootstrap prints of them", () => {
  it("says they are made by hand, and gives each one's detection and SQL for the dashboard", () => {
    const lines = alertLines(
      "demo",
      alerts("demo", ACCOUNT).filter(({ kind }) => kind !== "errors"),
      true
    );

    expect(lines).toStrictEqual([
      "bootstrap demo: make these 3 alerts by hand, as Custom Alerts in the dashboard: no API takes a custom alert's query yet (README, Alerts)",
      "bootstrap demo: each is custom SQL with an Automatic time range, sent to ALERT_EMAIL's address",
      "  demo issue spike: anomaly detection on spikes, evaluation window 10m, baseline window 2h, sensitivity 3, minimum event count 3",
      `    SELECT count() AS value FROM logs.issues WHERE accountTag = '${ACCOUNT}' AND scriptName IN ('platform-demo', 'sandbox-demo', 'web-demo')`,
      "  demo container failures: threshold, value >= 3, evaluation window 30m",
      `    SELECT count() AS value FROM logs.workersLogs WHERE accountTag = '${ACCOUNT}' AND scriptName IN ('platform-demo', 'sandbox-demo') AND level = 'error' AND (message LIKE '%sandbox job blocked%' OR message LIKE '%the Checker could not be reached%')`,
      "  demo refusal spike: anomaly detection on spikes, evaluation window 15m, baseline window 6h, sensitivity 3, minimum event count 5",
      `    SELECT count() AS value FROM events.analyticsEngine."metrics_demo" WHERE accountTag = '${ACCOUNT}' AND blob1 = 'Refused'`,
    ]);
  });

  it("names where they go without showing it, and says when it is not set", () => {
    const [, set] = alertLines("prod", alerts("prod", ACCOUNT), true);
    const [, unset] = alertLines("prod", alerts("prod", ACCOUNT), false);

    expect({ set, unset }).toStrictEqual({
      set: "bootstrap prod: each is custom SQL with an Automatic time range, sent to ALERT_EMAIL's address",
      unset:
        "bootstrap prod: each is custom SQL with an Automatic time range, sent to ALERT_EMAIL's address, which infra/.env.local does not set yet",
    });
  });
});

describe("the README", () => {
  it.effect("tells a person how to make every kind of alert by hand", () =>
    Effect.gen(function* () {
      const readme = Option.getOrElse(yield* textOf("README.md"), () => "");
      const start = readme.indexOf("### Alerts");
      const end = readme.indexOf("\n## ", start);
      const section = start === -1 ? "" : readme.slice(start, end);

      expect({
        dryRun: section.includes(
          "bun run bootstrap -- --stage <stage> --dry-run"
        ),
        kinds: alertKinds.filter((kind) => !section.includes(`**${kind}**`)),
      }).toStrictEqual({ dryRun: true, kinds: [] });
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
