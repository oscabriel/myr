import { kinds, territory } from "@myrtechnology/cli/rules";

export default kinds.fix.ask({
  context: [
    "addYears adds twelve months, so it follows: February 29 plus a year becomes February 28.",
  ],
  current:
    "addMonths runs over into the next month: January 31 plus one month is March 2 in a leap year and March 3 otherwise.",
  outOfScope: ["addDays and addWeeks, which count exact days", "diffInCalendarMonths"],
  path: "test/asks/add-months-clamp.test.ts",
  territory: territory.paths("src/add.ts", "test/add.test.ts"),
  want: "addMonths ends on the last day of the target month when that month is too short for the start date's day, in either direction: January 31 plus one month is February 29 in a leap year and February 28 otherwise. The time of day is kept.",
});
