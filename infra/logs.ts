// The stage's Workers Logs, read through Cloudflare's SQL API: smoke counts
// a deploy's errors with it, and the alerts in `alerts.ts` watch the same
// rows. Every query here reads counts by Worker, never a log's text, so
// nothing a log holds reaches a terminal or an alert.
import { resources } from "./stages.ts";
import type { Stage } from "./stages.ts";

export const SQL_API = "https://api.cloudflare.com/client/v4/analytics/sql";

// What reads a dataset through the SQL API: the token infra/.env.schema names
// needs it on the account CLOUDFLARE_ACCOUNT_ID names.
export const ANALYTICS_READ = "Account › Account Analytics › Read";

// A Workers Logs row that is an error: an uncaught exception, whose `error`
// is set, or a line logged at error level. A typed refusal is the product
// working and is never logged at error level, so none counts.
export const ERRORED = "(level = 'error' OR error != '')";

export const quoted = (text: string) => `'${text.replaceAll("'", "''")}'`;

export const workersOf = (stage: Stage): readonly string[] => {
  const { platform, sandbox, web } = resources(stage);

  return [platform, sandbox, web];
};

// One row per Worker that logged an error, `{ scriptName, errors }`; the
// time range goes beside the query, so no instant is written into its text.
export const errorsQuery = (workers: readonly string[]) =>
  `SELECT scriptName, count() AS errors FROM logs.workersLogs WHERE scriptName IN (${workers.map(quoted).join(", ")}) AND ${ERRORED} GROUP BY scriptName`;
