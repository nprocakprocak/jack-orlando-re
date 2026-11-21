# Jack Orlando engine

This repository is a TypeScript engine that plays Jack Orlando from files the user supplies. The engine is `packages/engine` (`src/` inside that package). `docs/dev/formats/` describes the file formats. `docs/dev/engine/` describes how play works. `docs/LEGAL.md` is the asset boundary.

The whole repository is in English.

Do not add game files: no archives, no executable, no saves, no pictures of the game, and no copied dialogue, scripts, or configuration. Menu captions, verb labels, slot labels, the three refusal captions, and the numeric tables live in the modules that use them. A test of other behavior builds its own bytes. A short invented label is enough.

```bash
npm test
npm run build
```

`npm test` and `npm run build` at the repository root delegate to the workspace packages.