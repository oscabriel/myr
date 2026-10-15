import { kinds, territory } from "@myrtechnology/cli/rules";

export default kinds.fix.ask({
  current: "The 11th, 12th and 13th of a month print as 11st, 12nd and 13rd.",
  mentor: "okonkwo",
  outOfScope: ["Ordinals in languages other than English", "Any token other than Do"],
  path: "test/asks/format-ordinal.test.ts",
  reserve: "newcomers",
  territory: territory.paths("src/format.ts", "test/format.test.ts"),
  want: "The Do token of format prints the day of the month as an English ordinal: 1st, 2nd, 3rd and 4th, 11th, 12th and 13th, then 21st, 22nd, 23rd and 31st.",
});
