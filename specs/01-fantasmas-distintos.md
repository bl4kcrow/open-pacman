# SPEC 01 — 4 fantasmas con comportamientos distintos

> **Status:** Implementado
> **Depends on:** none
> **Date:** 2026-09-24
> **Objective:** Hacer que los 4 fantasmas de Pac-Man actúen de forma distinta, con uno de ellos (Blinky) persiguiendo agresivamente a Pac-Man.

## Why this spec exists

`GHOST_STARTS` en `src/js/maze.js` hoy solo define 2 fantasmas con tipos `hunter`/`random` y un único `decideGhost` en `src/js/game.js` que hace elección de camino por distancia Manhattan (hunter) o aleatoria (random). El requisito pide 4 fantasmas con personalidades diferenciadas (lógica clásica: Blinky/Pinky/Inky/Clyde) y un ciclo global Scatter/Chase con modo Frightened. Esto toca la lógica de movimiento de `game.js` y la renderización de `render.js`, pero no la geometría del laberinto ni la máquina de estados existente.

## Scope

**In:**

- Definir 4 tipos de fantasma en `src/js/maze.js` (`GHOST_STARTS`): `blinky`, `pinky`, `inky`, `clyde`.
- Lógica de target distinta por tipo en `src/js/game.js`:
  - `blinky` → target = posición de Pac-Man (persigue agresivo).
  - `pinky` → target = 4 celdas delante de Pac-Man (emboscador).
  - `inky` → target = 2 delante de Pac-Man + vector reflejado respecto a Blinky (cooperativo/errático).
  - `clyde` → target = esquina propia si distancia a Pac-Man ≤ 8; si no, posición de Pac-Man (tímido).
- Ciclo global Scatter/Chase temporizado que afecta a todos los fantasmas activos.
- Modo `frightened` global: al comer energizer, fantasmas activos van a `frightened` (azules, velocidad reducida, movimiento errático); al expirar pasan a `eyes` (vuelven al pen).
- Salida escalonada del pen (release timers distintos por tipo).
- Estado `eyes` de retorno al pen y reintegración (`backInPen` → `exiting`/`active`).
- Diferenciación visual en `src/js/render.js`: color por tipo, azul en frightened, ojos en eyes.
- Estados `inPen`, `exiting`, `active`, `eyesReturning`, `backInPen` por fantasma.

**Out of scope (for future specs):**

- Niveles múltiples, velocidades por nivel o ajuste fino de timing más allá del nivel 1.
- Frutas/bonus, sonidos, animaciones de sprites detalladas, una forma reducida de modos.
- Modificaciones al laberinto (`MAZE`) o a tiles.
- Persistencia y puntuación avanzada (se mantiene la existente).
- Multijugador.

## Data model

```js
// En game.js, dentro de createGame(): los fantasmas se crean desde GHOST_STARTS.
const ghost = {
  x, y,              // posición continua (celdas)
  dir, nextDir,      // dirección actual y pendiente
  speed,             // px/frame según modo
  type,              // 'blinky' | 'pinky' | 'inky' | 'clyde'
  state,             // 'inPen' | 'exiting' | 'active' | 'eyesReturning' | 'backInPen'
  mode,              // 'chase' | 'scatter' | 'frightened' | 'eyes'
  releaseTimer,      // frames aún de espera en el pen antes de salir
  frightenedTimer,   // frames restantes en frightened
  targetX, targetY,  // celda objetivo según tipo
  homeCorner,        // { x, y } esquina de scatter/clyde
};

// En maze.js
const GHOST_STARTS = [
  { x: 13, y: 14, type: 'blinky' },
  { x: 14, y: 14, type: 'pinky' },
  { x: 13, y: 13, type: 'inky' },
  { x: 14, y: 13, type: 'clyde' },
];

// Estado global de juego (añadidos en game.js)
game.ghostMode;       // 'scatter' | 'chase' | 'frightened'
game.ghostModeTimer;  // frames restantes del modo global
game.ghostModeQueue;  // secuencia Scatter/Chase restante
```

Convenciones:
- Coordenadas: celda `(x,y)`, origen arriba-izquierda, igual que `MAZE`.
- Velocidades en px/frame. `GHOST_SPEED` ya existe; se define `FRIGHTENED_SPEED` y `EYES_SPEED`.
- `MAZE` permanece prístino: se copia por partida en `game.grid`. Los fantasmas no mutan `MAZE`.

## Implementation plan

1. En `src/js/maze.js`, sustituir `GHOST_STARTS` por las 4 entradas con `type` (mantener claves `x`,`y`; renombrar `kind` → `type`). Verificación: la consola no muestra errores al cargar `src/index.html`.
2. En `src/js/game.js`, añadir constantes: `FRIGHTENED_SPEED`, `EYES_SPEED`, `GHOST_RELEASE_TIMERS` (por tipo), `GHOST_MODE_SCHEDULE` (secuencia scatter/chase y duraciones), `GHOST_CORNER` (esquinas por tipo), `GHOST_FRIGHTENED_DURATION`.
3. En `createGame()`, inicializar cada fantasma con `type`, `state: 'inPen'`, `mode: 'scatter'`, `releaseTimer` por tipo y `homeCorner`. Añadir estado global `ghostMode: 'scatter'` y scheduler. El estado sigue en `Draft` hasta fin del paso; la partida carga igual.
4. Implementar `ghostTarget( game, g )` que devuelve `{ x, y }` según `g.type` (blinky/pinky/inky/clyde, con los cálculos descritos en Scope). Verificación: valores esperados para posiciones fijas de prueba.
5. Reescribir `decideGhost`: en `chase/scatter` elegir la dirección que reduce distancia a `ghostTarget` sin retroceder (salvo callejón); en `frightened` elegir dirección aleatoria entre las válidas sin retroceder; en `eyes` dirigir hacia la entrada del pen. `blinky` ya no usa la rama `kind === 'hunter'` antigua (se elimina).
6. Añadir `advanceGhostModes( game, frames )` que avance el scheduler global Scatter/Chase y los temporizadores por fanmasma (nueva salida del pen, frightened, eyedash), invocado desde `update()` con delta de frames.
7. Integrar ciclos: al activar `frightened` (comer energizer), pausar el scheduler global guardando el modo/timer restante; al expirar, pasar cada fantasma activo a `eyes`; al llegar al pen (`backInPen`), reanudar el scheduler guardado y reintegrar.
8. En `render.js`, dibujar cuerpo por `g.type` (rojo, rosa, cian, naranja), azul en `frightened`, y solo ojos en `eyes`. Verificación visual en el canvas.
9. Prueba manual integral (aplicar criterios de aceptación). Sin tests automáticos (proyecto sin framework).

## Acceptance criteria

- [ ] Al cargar `src/index.html` y empezar a jugar aparecen **exactamente 4 fantasmas** en el canvas.
- [ ] Los fantasmas llevan 4 tipos distintos: `blinky`, `pinky`, `inky`, `clyde` (definidos en `GHOST_STARTS`).
- [ ] `blinky` persigue la posición de Pac-Man de forma coherente (target = posición de Pac-Man).
- [ ] `pinky` apunta a ~4 celdas delante de la dirección de Pac-Man.
- [ ] `inky` calcula su target a partir de 2 celdas delante de Pac-Man reflejadas respecto a Blinky.
- [ ] `clyde` usa su esquina propia cuando está a ≤ 8 celdas de Pac-Man y persigue cuando está lejos.
- [ ] Los 4 fantasmas salen del pen **escalonadamente** (release timers distintos; blinky primero).
- [ ] El modo global alterna Scatter/Chase según el scheduler definido.
- [ ] Comer un energizer pasa a los fantasmas activos a `frightened` (colores azules, velocidad reducida, movimiento errático).
- [ ] Al expirar `frightened`, los fantasmas pasan a `eyes` y regresan al pen, reintegrándose luego (vuelven a salir escalonados y recuperan el ciclo).
- [ ] Colisión Pac-Man–fantasma en `frightened` convierte a ese fantasma en `eyes` (sin perder vida).
- [ ] Colisión Pac-Man–fantasma en modo normal (`chase/scatter`) mantiene el comportamiento de perdida de vida existente.
- [ ] Los fantasmas respetan las paredes (`tile === 1`) y el wrap del túnel (fila 14); no atraviesan muros.
- [ ] `MAZE` no se muta y el juego conserva los estados `start / playing / won / lost`.

## Decisions

- **Yes:** 4 fantasmas clásicos (Blinky/Pinky/Inky/Clyde) con lógica target-based. Opción del usuario (a) en Fase 2; es el comportamiento reconocible del Pac-Man clásico.
- **Yes:** Blanco Pensar Inky+Blinky... (ver abajo) — la combinación de esquinas + vecino de Blinky.
- **Yes:** Ciclo global Scatter/Chase temporizado + frightened con eyes (opciones (a) del usuario).
- **Yes:** Salida escalonada del pen con release timers por tipo.
- **No:** Configuración "solo por algoritmo sin nombres" (opción (c) descartada): el requisito pide que "uno persiga agresivamente", lo que naturalmente se modela con Blinky.
- **No:** Simular perseguir con un solo target global para todos; cada tipo mantiene su propio cálculo.
- **No:** Cambiar el sistema de 4 `<script>` globales a ES modules; se respeta la arquitectura `window`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Frightened pausa el scheduler global y puede perderse el modo al reanudar | Guardar `ghostMode` y `ghostModeTimer` antes de pausar; restaurarlos al reintegrar en `backInPen`. |
| Errático en `frightened` puede hacer al fantasma quedar atascado en callejones | Reutilizar regla de callejón (permitir retroceso si no hay opciones) ya presente en `decideGhost`. |
| Salida escalonada con visual entrando/saliendo confusa | Mantener `inPen`/`exiting` discretos y dibujar todo el cuerpo ya desde `inPen`. |

## What is **not** in this spec

- Niveles múltiples y velocidades por nivel (va en otra spec).
- Frutas/bonus, sonidos y animaciones de sprite detalladas.
- Modificación de la geometría del laberinto (`MAZE`).
- Persistencia y puntuación avanzada.
- Multijugador.
