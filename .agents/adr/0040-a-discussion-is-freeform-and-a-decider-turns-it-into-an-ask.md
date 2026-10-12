---
status: accepted
---

# A discussion is freeform, and a decider turns it into an ask

A proposal works for someone who already knows the change they want. Most wants start vaguer than that: a bug half-understood, an idea that needs a maintainer's context, two people who disagree about the right shape. Today that talk has to happen somewhere else, or as proposals that get declined and proposed again. PRODUCT declined discussion threads for the competition window, "not now, not never".

The decision: a project has discussions. A discussion is a public, freeform thread: a title, then posts in Markdown, each by a handle, in order. Anyone signed in and not denounced may open one or post in one. A discussion carries no type, kind, label, vote or reaction, and it lands nothing. The typed part starts when a decider turns a discussion into an ask. One call makes a proposal from the discussion and starts its first draft round (ADR 0018), with the discussion's posts as the want the agent drafts from. From there nothing changes: the decider can draft again with a note, the draft runs red first, and the decider accepts or declines it in Today. Accepting it runs the unchanged `accept`, so the ask opens through the gate like any other.

The details:

- **Credit.** The proposal's proposer is the person who opened the discussion, credited as `Asked-by` when the ask opens. When turning a discussion into an ask, the decider may name participants whose posts shaped it, and they are credited as `Advised-by` on the same landing. The trailer exists already.
- **Vouches.** A credited landing counts as the landing a newcomer is welcomed after (ADR 0036). Someone who is not vouched for and is credited on an opening, as `Asked-by` or `Advised-by`, appears in Today's "Newcomers to welcome" with that landing as the vouch line's `for`, as an answerer does. The vouch is still the decider's choice, and its default is no vouch. A project's trust rules may ask for more of the Record before Today offers it.
- **The drafter reads the thread as quoted text.** Anyone can post, so anyone can try to steer the agent. The context step puts the discussion's posts in the prompt as quoted content, marked as the words of the named handles and not as instructions, and leaves hidden posts out. Within its byte budget it keeps the opening post and the latest posts. The decider's note, when there is one, is the only instruction beside the platform's own. A draft still lands nothing without a decider, and its check still runs red first on the Checker.
- **Moderation.** A denouncement bars posting as well as proposing. A decider of the project may hide a post with a reason: its text leaves every page and the drafter's context, and the thread shows the line in its place ("hidden by kai: off-topic"). A decider may close a discussion with a note, and a discussion turned into an ask closes with a link to its proposal. A discussion with no post for 60 days closes itself. A decider may reopen any closed discussion.
- **Rounds stay silent.** A discussion is about a want, before or around an ask. It never attaches to a round or an answer, where the gate's verdict is the only voice.
- **The record.** The Project Durable Object keeps each discussion, as it keeps proposals. When a discussion closes, the platform writes it to `refs/discussions/<id>` as one commit that holds its posts, so a clone that fetches the ref carries the talk with the code. Only the platform writes these refs, since a fork takes branches only (Principle 7). Hiding a post in a closed discussion rewrites its ref without the post's text. A clone that fetched the ref before keeps the text, and the Discussion page says so.
- **Visibility.** Every discussion is public. A project's layers never reach one: a discussion reads no layer, and the drafter's context step reads none either (ADR 0018).

## Considered Options

- **Typed shaping.** Versioned amendments to a draft, each run red first, with named stances (satisfied, blocking with a reason) put to the decider as evidence, and a decision default that flips to accept once no stance blocks. It would show progress toward consensus as data. It also asks everyone in the talk to work in the gate's terms before anyone knows what the ask is, and stances drift toward a vote count. The decider's draft rounds already climb toward the right check; the talk before them does not need to.
- **No discussion at all**, as PRODUCT said for the window. Talk then happens on another site, where none of it reaches the drafter, the credit or a vouch.
- **Threads on asks and answers**, as forges do on issues and pull requests. A thread on a round invites review by comment, which a finish replaces, and a thread on an ask duplicates `ask flag`. A discussion may link an ask; it does not hang off one.
- **Each post as a commit under the discussion's ref, pushed as it is written.** A clone would carry the live talk, but every post would be a push to Artifacts and an event `OnPush` must recognize and ignore (ADR 0014). Writing the ref once, at close, keeps pushes per discussion to one.
- **Votes or reactions on posts or discussions.** A count beside a want is a score by another name, which PRODUCT declines.

## Consequences

- `packages/protocol` gains contracts to open, read, list, post in, hide a post in, close and reopen a discussion, and one for a decider to turn a discussion into a proposal with its first draft round and the handles to credit. The web, the CLI and MCP serve them, so posting becomes one of the web's permitted writes.
- The `Proposal` schema gains the discussion it came from and the handles to credit as `Advised-by`. The Lander writes both trailers on the opening.
- The drafter's context step gains the discussion's posts as quoted, attributed text, with a test that a hidden post never reaches the prompt and that a post's text is never placed as an instruction.
- The vouch file's denouncement reads as barring posts too, with no change to its line.
- PRODUCT's "no discussion threads" becomes "no discussion on rounds".
- Not built in the competition window; no dependency is added.
