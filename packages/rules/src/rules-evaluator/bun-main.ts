/**
 * It imports each module in turn, so it can tell a module that would not load
 * from one whose code threw. Plain JavaScript as source text, like the prelude.
 *
 * `job.json`: `{entry, project?: {file, path}, visibility?: {file, path},
 * asks: [{file, path}]}` for an evaluation, plus `{rule, facts}` for a call;
 * `file` is where a module was written, `path` its path in the bundle.
 */
export const bunMain = `
import job from "./job.json" with { type: "json" };

// Taken before any config code runs; the prelude sends its logging to stderr.
const out = process.stdout;

const loadErrors = new Set(["BuildError", "BuildMessage", "ResolveError", "ResolveMessage", "SyntaxError"]);

const isLoadError = (error) =>
  error instanceof AggregateError
    ? error.errors.length > 0 && error.errors.every(isLoadError)
    : loadErrors.has(error?.constructor?.name) || error instanceof SyntaxError;

const describe = (error) =>
  error instanceof AggregateError
    ? error.errors.map(describe).join("; ")
    : error instanceof Error
      ? error.name + ": " + error.message
      : String(error);

const failed = (where, error, reason) => ({
  _tag: "Failed",
  detail: where + ": " + describe(error),
  reason: reason ?? (isLoadError(error) ? "load" : "threw"),
});

const load = async ({ file, path }) => {
  try {
    const module = await import(file);
    return { exported: { definition: module.default, path } };
  } catch (error) {
    return { failure: failed(path, error) };
  }
};

const run = async () => {
  const entry = await import(job.entry);
  const project = job.project === undefined ? undefined : await load(job.project);

  if (project?.failure !== undefined) {
    return project.failure;
  }

  if (job.rule !== undefined) {
    try {
      const rule = entry.ruleOf(project?.exported.definition, job.rule);
      return { _tag: "Called", result: rule === undefined ? false : await rule(job.facts) };
    } catch (error) {
      return failed(job.rule, error, "threw");
    }
  }

  const asks = [];

  for (const ask of job.asks) {
    const loaded = await load(ask);

    if (loaded.failure !== undefined) {
      return loaded.failure;
    }

    asks.push(loaded.exported);
  }

  const visibility = job.visibility === undefined ? undefined : await load(job.visibility);

  if (visibility?.failure !== undefined) {
    return visibility.failure;
  }

  try {
    return { _tag: "Collected", ...entry.collect(project?.exported, asks, visibility?.exported) };
  } catch (error) {
    return failed("the config folder's exports", error, "threw");
  }
};

const result = JSON.stringify(await run()) + "\\n";

await new Promise((resolve) => out.write(result, resolve));

// Config code may leave a timer running; the one result is out.
process.exit(0);
`;
