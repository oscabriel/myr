# The demo

How the submission video is made. On recording day, open these in this order:

1. [`rehearsal.md`](rehearsal.md): the pre-flight list, then one checkbox per shot, marked pass or fail when the shots were walked on the live stages.
2. [`shot-list.md`](shot-list.md): every shot, with its screen, the exact command or URL on the `demo` stage, what must already be true, a fallback, and the order to record in.
3. [`script.md`](script.md): the narration, timed to the video's seven beats (6:30), with the captions.
4. [`swarm-scenario.md`](swarm-scenario.md): the six fictional contributors of beats 3 and 4, what the video stages and why, how to run them, and what to do when an agent stalls.

Three rules hold for every take:

- **No deploys during takes.** A deploy restarts the platform mid-take. `rehearsal.md` opens with it.
- **What is staged is labelled as staged**, in the script and in a caption: the README line in the zero-install beat, two of the six agents' nudges, and one answer written to fail a sealed check. Nothing else is planted, and every outcome is read from the platform.
- **The people and the two projects on screen are fictional.** datekit and burrow, and everyone in them, are examples made up to show the platform; no real person is staged. The open-source repos the code browser is previewed on are imported beside them, read-only, each shown with the source it was imported from, and nothing in the video acts on one.

Every command in these files is checked against what exists: a test reads each shell block, the shot list and every CLI command named in prose or a table, and fails on a root script, a file, a CLI command or a flag that isn't there. It also holds each shot to its beat in the script, and the rehearsal to one checkbox per shot.
