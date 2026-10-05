# Contributing to domia-core

Thanks for wanting to help. Domia is a local voice agent that runs on the user's own hardware; this repository is its core. Developers, designers, voice artists and people who simply run it at home and report what breaks are all welcome.

The rules of the codebase are in [`AGENTS.md`](AGENTS.md). They apply to people and to coding agents alike; read them before a first change.

## Set up

1. Follow [`GETTING_STARTED.md`](GETTING_STARTED.md) to get a node running (Node 24, Docker Compose, sox).
2. `npm run dev` starts a node with reload. `npm run stop` stops it.

## Make a change

1. Open an issue first for anything larger than a fix, so the direction is agreed before the work.
2. Branch from `main`.
3. Keep the change focused. One concern per pull request.
4. Verify it:
   - `npm run check` — build, lint, typecheck of the evals
   - `npm test` — the pure battery
   - the suite that covers the area you touched (table in `AGENTS.md`)
   - for anything on the voice path, a real turn through the node
5. Add a check to the suite that owns the area when you add behaviour.

A schema change has no migration: it ships with `npm run db:reset`, which wipes a node's database. Say so in the pull request.

## Commit messages

Follow [`COMMITS.md`](COMMITS.md): `<emoji> <type>: <short narrative> — <optional phrase>`, present tense.

## Pull requests

The template asks for three things: what changed and why, how you verified it (the commands and what they printed), and the rule checklist. A pull request that says "tests pass" without saying which is sent back.

## Who decides what

- The maintainer reviews and merges every pull request.
- Defaults (models, thresholds, engines), the roadmap and releases are the maintainer's call. Proposals are welcome as issues; a default changes on measured evidence from the eval suites, on modest hardware.
- Disagreement is fine. Bring numbers.

## Contributions made with AI tools

Welcome, and held to exactly the same bar. The person opening the pull request is responsible for it: they have read the diff, they ran the verification, and the description says what was actually run. Do not add tool attribution or `Co-Authored-By` lines for an AI tool.

## Reporting problems

- Bugs and feature ideas: the issue forms.
- A skill or tool that is picked wrongly or behaves wrongly: the "Skill or routing report" form.
- Security problems: never in a public issue — see [`SECURITY.md`](SECURITY.md).
- Do not attach real voice recordings of other people, tokens or `.env` files to an issue.

## License

By contributing you agree that your contribution is licensed under the Apache License 2.0, the license of this repository.
