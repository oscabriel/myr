# .agents

The working record behind the build: how the repo was planned, decided and run. The product's own docs stay at the root (`README.md`, `AGENTS.md`, `GLOSSARY.md`, `PRODUCT.md`, `DESIGN.md`).

- `adr/`: one numbered decision record per choice, with its status and why.
- `workflow/`: how agents track issues, label them and read the domain docs.
- `scratch/`: `TEMPLATE.md`, the ask every issue is written from. The issues themselves live in `scratch/build/`, which git ignores.
- `ops/`: `stages.md`, every stage's resources, secrets and teardown.
- `demo/`: the recording's script, shot list, swarm scenario and rehearsal checklist.
