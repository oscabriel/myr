# datekit

Small, dependency-free date helpers for TypeScript. datekit reads ISO 8601 text, shows dates with patterns, and adds and diffs in whole units. Dates are plain `Date` instants, and datekit works in UTC unless you name a time zone, so the same code gives the same answer on every machine.

> datekit and its maintainers are fictional: it is an example project made up to show Myr, the git platform it is hosted on.

## Install

```sh
bun add datekit
```

datekit has no dependencies and ships its TypeScript source, which Bun, Deno and any bundler read as is. It needs a runtime with `Intl` time zone data for the `timeZone` option; Bun, Deno, Node and every current browser have it.

## Usage

```ts
import { addMonths, diffInDays, format, parseISO } from "datekit";

const shipped = parseISO("2026-10-07T14:30:00+01:00");

format(shipped, "EEE, d MMMM yyyy 'at' HH:mm"); // "Wed, 7 October 2026 at 13:30"
format(shipped, "h:mm a XXX", { timeZone: "Asia/Tokyo" }); // "10:30 PM +09:00"

const renewal = addMonths(shipped, 3);
format(renewal, "yyyy-MM-dd"); // "2027-01-07"
diffInDays(renewal, shipped); // 92
```

## Reading dates

`parseISO(text)` reads ISO 8601:

- a calendar date: `2026-10-07`, or `20261007`; `2026-10` is the month's first day and `2026` is January 1;
- an ordinal date: `2026-280` is the 280th day of 2026;
- then optionally `T` and a time, `14:30`, `14:30:15` or `14:30:15.250`, with a UTC offset, `Z`, `+09:00` or `-0330`.

Text with no offset is read as UTC. Digits past the millisecond are dropped, not rounded.

`parseISO` never throws. Text it can't read, or a day that doesn't exist (`2026-02-29`, `2026-04-31`), gives an invalid date; check with `isValid(date)`.

## Showing dates

`format(date, pattern, options?)` shows a date with a pattern, in UTC or in `options.timeZone`.

| Token | Shows | Example |
| --- | --- | --- |
| `yyyy`, `yy` | year | `2026`, `26` |
| `MMMM`, `MMM`, `MM`, `M` | month | `October`, `Oct`, `10`, `10` |
| `Do`, `dd`, `d` | day of the month | `7th`, `07`, `7` |
| `EEEE`, `EEE` | day of the week | `Wednesday`, `Wed` |
| `HH`, `H` | hour, 24-hour clock | `14`, `14` |
| `hh`, `h`, `a` | hour, 12-hour clock, and AM or PM | `02`, `2`, `PM` |
| `mm`, `ss`, `SSS` | minute, second, millisecond | `05`, `09`, `250` |
| `XXX` | UTC offset | `Z`, `+09:00`, `-04:00` |

### Format patterns

- Text in single quotes is printed exactly as written: `'Week of' MMMM d` is `Week of October 7`. Two single quotes print one: `h 'o''clock'` is `2 o'clock`.
- Punctuation, digits and spaces pass through as they are.
- A letter outside quotes that is no token throws a `RangeError`, so a typo never prints a wrong date. So does an invalid date, or a time zone the runtime doesn't know.

## Moving dates

`addMilliseconds`, `addSeconds`, `addMinutes`, `addHours`, `addDays`, `addWeeks`, `addMonths` and `addYears` each return a new date and leave their argument alone. Amounts are whole numbers; a fraction is dropped toward zero. Every day in UTC is 24 hours long, so `addDays` adds exact days. `addMonths` keeps the day of the month and the time of day, and `addYears` adds twelve months.

## Comparing dates

The `diffIn…` functions take the later date first and count whole units, dropping a part unit toward zero, so the result is negative when the first date is the earlier one.

| Function | Counts |
| --- | --- |
| `diffInMilliseconds`, `diffInSeconds`, `diffInMinutes`, `diffInHours` | exact time |
| `diffInDays`, `diffInWeeks` | whole 24-hour days and weeks |
| `diffInCalendarDays` | UTC midnights crossed |
| `diffInCalendarMonths` | month boundaries crossed |

`isLeapYear(year)`, `daysInMonth(year, month)` (months 1 to 12) and `daysInYear(year)` answer calendar questions.

## Time zones

datekit keeps instants and never shifts them; a time zone only changes how a date is shown. `format` takes any IANA zone (`Europe/Lisbon`, `America/New_York`) and follows its daylight saving time. `zonedParts(date, timeZone)` gives the wall-clock fields and the offset, `offsetIn(date, timeZone)` the offset alone in minutes east of UTC, and `isTimeZone(name)` says whether the runtime knows a zone. The zone data is the runtime's own, so datekit ships none.

## Contributing

What we want changed is written down as asks, one file each in `.myr/asks/`: a sentence saying what should happen, and a test in `test/asks/` that fails until it does. To answer one:

```sh
myr asks --project datekit       # what is open
myr ask format-ordinal           # read one in full
myr claim format-ordinal         # take it; this prints your fork's remote
git remote add myr <remote>      # the remote the claim printed
myr check                        # run its test and the suite, as the platform will
git push myr HEAD:main           # offer your answer
```

The platform runs the ask's test and the rest of the suite on your answer, and lands it on main with your name on it when both pass. An answer changes only the files its ask names. `format-ordinal` is kept for newcomers, with okonkwo as mentor.

Claiming needs a vouch: a line in `.myr/vouched.td`. Anyone not denounced there may ask for one in a discussion with `myr discussion post`, and a maintainer opens the ask from it.

Run the tests with `bun test`. On main, the three asks' tests fail; everything else passes.

## Environment

`.env.schema` declares the variables the docs site and the release step read, in varlock's `@env-spec` format. Test values are committed in `.env.test`. The source-map upload token is set by a maintainer for releases and never committed, and no check ever sees it.

## Maintainers

- `ines-v` decides for the whole library.
- `okonkwo` decides for time zones (`src/tz.ts`).

## License

MIT
