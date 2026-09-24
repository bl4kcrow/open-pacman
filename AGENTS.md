# AGENTS.md

Vanilla JS + HTML + CSS Pac-Man clone (canvas), built to practice spec-driven development. **Project language is Spanish** — README, code comments, and UI strings are all Spanish; keep new ones Spanish.

## Run / verify

- No build step, no dependencies, no `package.json`. Open `src/index.html` directly in a browser.
- No tests or linter. Verify changes by loading the page and checking the console.

## Architecture

- Four classic `<script>` tags sharing globals — **not** ES modules. Keep the load order in `src/index.html`: `maze.js` → `game.js` → `render.js` → `main.js`.
- Cross-file sharing happens only via `window` (`window.MAZE`, `window.createGame`, `window.update`, `window.draw`, `window.DIRS`). New shared functions must be attached to `window`; don't introduce `import`/`export` without rewiring everything.
- Responsibilities: `maze.js` = level data, `game.js` = state + rules, `render.js` = canvas drawing, `main.js` = game loop (`requestAnimationFrame`) + screens. State machine: `start` / `playing` / `won` / `lost`.

## Maze / grid conventions (`src/js/maze.js`)

- 28×31 grid, cell coords `(x, y)`, origin top-left. Tile values: `0` passable, `1` wall, `2` dot, `3` pen door.
- `MAZE` is pristine and copied per game in `game.js` (`MAZE.map((row) => row.slice())`). **Never mutate `MAZE` directly.**
- `TUNNEL_ROW = 14` enables horizontal wrap-around; `PACMAN_START` and `GHOST_STARTS` are consumed by `game.js`. Tiles are 20px (`TILE` in `render.js`), canvas is 560×620.

## Code style

- 2-space indent; call args use inner spaces: `array.map( ( row ) => ... )`, `getElementById( 'game' )`, but `()` empty parens. This is consistent — match it, don't "fix" it.

## Spec-driven workflow

- This project exists to practice the spec-driven method. Skills are vendored in `.agents/skills/` (`spec`, `spec-impl`); lockfile is `src/skills-lock.json`.
- Use `/spec` for new features: it writes `specs/NN-slug.md` (repo root) and seeds `specs/.spec-config.yml`. `/spec-impl` only runs when the spec's status means "Approved"/"Aprobado", creates a `spec-NN-slug` branch, implements step-by-step, and never auto-commits.
- `specs/` does not exist yet; the first spec starts at `01-`.