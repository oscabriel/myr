import { kinds, territory } from "@myr/cli/rules";

export default kinds.fix.ask({
  current:
    "parseISO gives an invalid date for every week date, so a payroll week or a sprint stored as 2026-W41 can't be read back.",
  outOfScope: [
    "Showing week dates: format has no week-numbering tokens yet",
    "Weeks that start on a day other than Monday",
  ],
  path: "test/asks/parse-iso-week.test.ts",
  territory: territory.paths("src/parse.ts", "test/parse.test.ts"),
  want: "parseISO reads ISO 8601 week dates (2026-W41-3, the basic 2026W413, and 2026-W41 for the week's Monday) as the UTC midnight of that day, with the same optional time and offset as a calendar date, and gives an invalid date for a week the year doesn't have.",
});
