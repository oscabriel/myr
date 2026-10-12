# The script

The narration for the submission video: seven beats, 6:30 of the allowed 5 to 10 minutes. Each beat names the shots on screen (their ids are in [`shot-list.md`](shot-list.md)), the words to read, and the captions. Read at about 150 words a minute; each beat's narration fits its range at that pace, with room for the screen to speak.

The narration is the recorder's voice. A rehearsal corrects commands and URLs in the shot list, never these words.

Rules that hold in every beat:

- **No rival is named**, on screen or aloud. A contrast is said by its mechanism.
- **No host product names.** The platform's storage, sandbox and preview products are not named in the video; the README says what it runs on.
- **"Prototype", never "a whole forge".** No claim about speed or scale beyond the measured table in the last beat.
- **What is staged is said to be staged**, aloud or in a caption: the README line in Zero install, the two nudged agents in One weed becomes a rule and Six harnesses at once, and bram's broken quoting in The top half is open. [`swarm-scenario.md`](swarm-scenario.md) lists every nudge.
- **Held-back checks are "checked against N sealed checks"**, never "verified" or "good".
- **One credit on screen:** varlock's, as a caption in the env shot. Every other credit is in the README.
- Say the name once, early: Myr, said "meer".

## The front door broke (0:00–0:45)

On screen: S01, then S02.

> "Open source has one front door: the pull request." Then agents made writing a change nearly free, and reading one costs what it always did. So projects started closing the door.
>
> Myr, said "meer", is a prototype git platform that turns the door around. A project asks for what it wants: a sentence, the files it may touch, a check that fails today. Anyone answers, or their agent does; passing answers land. Unasked work has nowhere to go.
>
> No setting adds this: answers can't touch their judge, sealed checks say one bit per area, refusals are typed in git's output, claims hold slots, and credit, the asker's too, follows people across projects.

Caption on S02: "An ask: a want, a territory, a check that fails on main."

If the beat runs short, add: "Forges for agents are being built for teams shipping hundreds of changes a day. We built one for the boundary between a project and everyone else."

## Zero install (0:45–1:30)

On screen: S03, S04 (or S05), S06.

> This is Claude Code as it ships: no plugin, no MCP server, no skill. It has a datekit clone and our CLI, and reads the repo's AGENTS.md. I ask it to land an open ask, and, staged so you see a refusal, to add a README line the ask doesn't cover.
>
> It claims the ask, gets a fork, and pushes. git's own output carries the refusal: OutOfScope, the path, and the next command. It puts the README back and pushes again. The platform checks the merged tree and lands it. The commit names who asked and who signed; the agent is listed apart, as a disclosure, not credit.

Captions: on S03, "Stock Claude Code. No plugin, MCP server or skill."; on S04, "Staged: the prompt asks for a README line outside the ask's territory." If S05 replaces S04: "The same refusal, pushed by hand."

## One weed becomes a rule (1:30–2:15)

On screen: S07, S08, S09, then S10 and S11 (cut in from the S12 take).

> burrow is a fictional shop's six services, on one HTTP kit. Its maintainers fence their own agents: lint presets, a git hook, and a rule against state at the top of a module. Six places break it, so the rule landed as a ratchet: six, and the count may only fall.
>
> One old helper, legacyFetch, is on its way out. One migrate ask splits that job like the code: a child per package, and a delete child that waits for all six.
>
> That fence now runs at the door, from the last landing, for strangers' agents. A disable comment with no reason is refused; one with a reason waits for a person.

Captions: on S09, "The plan prints every nudge. Two agents were told about disable comments: what follows is staged."; on S10, "Weakened"; on S11, "Waiting on a decision".

## Six harnesses at once (2:15–3:45)

On screen: S12, with S13 beside it, then S14.

> Six fictional contributors, each answering one child with an agent of their own. Four harnesses, six models: Claude Code as it ships, OpenCode on a GPT model, Amp, and pi on three model families, one of them with our pi adapter. Each agent works in its own fork, with plain git and its person's token. No agent holds an account: the person's claim carries identity and credit.
>
> Refusals bounce on screen, and every one is typed: a tag, a reason, a place, and the command to run next. The run hands each one back to the same session, at most three times. Weakened is the agent that was told a disable comment was fine. The one told to give a reason is waiting on a decider.
>
> When main moves under an answer, the platform merges again and checks again before anything lands. An answer that no longer fits gets StaleBase back, never a silent retry.
>
> Children land one at a time, each a commit with its person's name on it. The counter counts claims, pushes and landings from the project's live stream. When the sixth child lands, nothing calls legacyFetch any more, and the delete child opens.

Captions: on S12, "4 harnesses, 6 models"; on the Weakened pane, "Staged: told a disable comment is acceptable"; on the waiting pane, "Staged: told to give a reason".

Read the StaleBase paragraph only if the take shows one; the children touch disjoint packages, so a merge again usually succeeds.

## The top half is open (3:45–5:00)

On screen: S15, S16, S17, S18, S19, S20.

> datekit's maintainers keep checks of their own, in a layer only they can read. The layer is declared in public, with its reason. Two clones of the same project: bram, a contributor, gets a 403 on the layer. ines-v, a maintainer, gets the sealed checks.
>
> bram's answer passes every check he can see. It was written to break one rule the public tests don't cover. The refusal reaches his terminal: HeldBackFailed, area export. One bit per area, never a check's name or its output, and at most three failures per claim in a week. He fixes it, and the landing carries a trailer: Held-back, export seven of seven, at the suite's published root. That means checked against seven sealed checks, not proven good. They're hidden from people and agents, not from the code under test, so they aren't a security boundary. The ledger says which kind of open this is: Open with sealed evidence.
>
> Why can't we commit .env files? Commit the shape. Deciders set the values. Nobody reads them back. An answer's code only ever sees a placeholder.

Captions: on S17, "Staged: this answer breaks quote escaping on purpose."; on S20, "env shape: varlock's `.env.schema` format".

If the video runs long, cut the last paragraph and S20 first.

## The maintainer's day (5:00–5:45)

On screen: S21, S22, S23.

> okafor decides for burrow. Their day is one page, Today: decisions, not diffs, held to a budget. The reasoned escape from the run waits here, with its evidence, an expiry and a safe default. If nobody decides, nothing lands. Below it, a sample of landings that needed nobody.
>
> The front page lists the open asks across every project, each saying whether you may take it, and which are held for newcomers.
>
> And any line can say why it's there: the ask, who asked, who answered, the verdict, and the agent that helped.

## Measured numbers (5:45–6:30)

On screen: S24, S25, then S26.

> These numbers come from live runs, each with its stage and date.
>
> [Read the rows of the README's Numbers table as they stand on the day. Say no number that isn't in it.]
>
> Everything here is plain git. Code, asks and credit trailers leave with a clone; the verdict notes take one more fetch. Nothing to export, nothing to sync, and nothing reaches main except through the gate.
>
> The top half is open. The bottom half is typed.
