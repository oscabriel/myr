import { project, run } from "@myrtechnology/cli/rules";

// `myr init` found no command that runs one test file ({path}), so
// the platform reads the run block from CI at each landing. It found:
//   setup: "bun install --frozen-lockfile" (setup inferred from bun.lock)
//   test: "bun run test" (test from package.json)
//   checks.lint: "bun run check" (checks.lint from package.json)
//   checks.types: "bun run typecheck" (checks.types from package.json)
//   checks.unit: "bun run test" (checks.unit from package.json)
// A red-first ask needs a test command with {path}; once one is here, give the unit
// lane the runner's flag that skips test/asks/**, or every answer's unit lane is red while another ask is open.
export default project({
  run: run.fromCI,
  // Anyone not denounced in vouched.td may claim an ask; "forCode" admits
  // only the people vouched for there, which a maintainer lands with vouch.
  vouch: "bansOnly",
});
