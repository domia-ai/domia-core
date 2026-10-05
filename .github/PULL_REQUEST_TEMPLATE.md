## What changed and why

<!-- One or two paragraphs. Link the issue if there is one. -->

## How it was verified

<!-- The commands you ran and what they printed. "Tests pass" is not enough. -->

- [ ] `npm run check`
- [ ] `npm test`
- [ ] Suite for the area touched: <!-- name it and paste the result line -->
- [ ] A real turn through a node, if the voice path changed <!-- text, WAV or satellite bench; paste the numbers -->

## Checklist

- [ ] Functional style: factories and pure functions, no classes, no mutation of inputs, `let` only for closure state
- [ ] No comments in code; named types only in `types/index.ts`
- [ ] Nothing tunable is hardcoded — new knobs are database columns with a default in `src/db/constants`
- [ ] Defaults still make sense on modest hardware
- [ ] Works standalone, with several identities, through a satellite and through delegation — or the description says what was not covered
- [ ] No provider-specific vocabulary outside its specialization; routing changes are data (descriptor) and were measured
- [ ] New behaviour has a check in an eval suite
- [ ] No secrets, databases, model files or real voice recordings in the diff

## Schema

- [ ] No schema change
- [ ] Schema change — needs `npm run db:reset` on every node (it wipes the database)
