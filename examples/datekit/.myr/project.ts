import { kinds, project } from "@myr/cli/rules";

/**
 * How datekit takes changes. Each change we want is an ask in asks/, with a
 * test that fails on main; an answer lands when that test passes and the
 * rest of the suite stays green. ines-v decides for the whole library, and
 * okonkwo for time zones.
 */
export default project({
  agents: "trailer",
  budget: { decisionsPerDay: 5, expire: "14 days" },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  deciders: {
    "**": ["ines-v"],
    "src/tz.ts": ["okonkwo"],
  },
  kinds: [kinds.fix, kinds.changeJudge],
  run: {
    // An open ask's test fails on main until it is answered, so the suite
    // every answer must keep green leaves the asks' tests to their own lane.
    checks: { unit: "bun test --path-ignore-patterns='test/asks/**'" },
    test: "bun test {path}",
  },
  vouch: "forCode",
});
