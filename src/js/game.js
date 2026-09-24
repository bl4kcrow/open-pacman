// game.js
// Estado y reglas. Depende de globals de maze.js: MAZE, TUNNEL_ROW,
// PACMAN_START, GHOST_STARTS.

const DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

const PACMAN_SPEED = 0.125; // 1/8 celda/frame -> alinea cada 8 frames
const GHOST_SPEED = 0.1;    // 1/10 celda/frame
const FRIGHTENED_SPEED = 0.075; // 3/40 celda/frame, mas lento que GHOST_SPEED
const EYES_SPEED = 0.2;         // 1/5 celda/frame, rapido: solo ojos de vuelta al pen

// Salida escalonada del pen: frames de espera por tipo (blinky primero).
const GHOST_RELEASE_TIMERS = {
  blinky: 0,
  pinky: 30,
  inky: 60,
  clyde: 90,
};

// Ciclo global Scatter/Chase. Cada entrada es { mode, frames }; la ultima es
// { mode: 'chase', frames: Infinity } y se queda en chase indefinidamente.
const GHOST_MODE_SCHEDULE = [
  { mode: 'scatter', frames: 420 },
  { mode: 'chase', frames: 1200 },
  { mode: 'scatter', frames: 420 },
  { mode: 'chase', frames: 1200 },
  { mode: 'scatter', frames: 300 },
  { mode: 'chase', frames: 1200 },
  { mode: 'scatter', frames: 300 },
  { mode: 'chase', frames: Infinity },
];

// Esquina propia de cada tipo (target de scatter y refugio de clyde).
const GHOST_CORNER = {
  blinky: { x: 27, y: 0 },  // arriba-derecha
  pinky: { x: 0, y: 0 },    // arriba-izquierda
  inky: { x: 27, y: 30 },   // abajo-derecha
  clyde: { x: 0, y: 30 },   // abajo-izquierda
};

const GHOST_FRIGHTENED_DURATION = 480; // frames (~8s a 60fps)

// Entrada del pen: celda justo encima de la puerta (los ojos regresan aqui).
const PEN_ENTRANCE = { x: 13, y: 11 };

// Energizers: los 4 dots clasicos se marcan como tile 4 solo en game.grid
// (MAZE queda pristino; el valor 2 original se conserva en el original).
const GHOST_ENERGIZERS = [
  { x: 1, y: 3 },
  { x: 26, y: 3 },
  { x: 1, y: 23 },
  { x: 26, y: 23 },
];

// Crea una partida nueva. Copia MAZE (pristino) a game.grid para poder comer
// dots sin destruir el original, y reiniciar.
function createGame() {
  const grid = MAZE.map( ( row ) => row.slice() );
  // La celda de inicio de Pacman arranca sin dot.
  grid[ PACMAN_START.y ][ PACMAN_START.x ] = 0;

  let dots = 0;
  for ( const row of grid ) for ( const v of row ) if ( v === 2 ) dots++;

  // Los 4 dots clasicos actuan como energizers solo en la copia de juego.
  GHOST_ENERGIZERS.forEach( ( e ) => {
    if ( grid[ e.y ][ e.x ] === 2 ) grid[ e.y ][ e.x ] = 4;
  } );

  return {
    state: 'start',
    score: 0,
    lives: 3,
    dotsRemaining: dots,
    grid,
    ghostMode: 'scatter',              // modo global de los fantasmas
    ghostModeTimer: 0,                 // frames consumidos del segmento actual
    ghostModeQueue: GHOST_MODE_SCHEDULE.slice(), // segmentos Scatter/Chase restantes
    pacman: {
      x: PACMAN_START.x,
      y: PACMAN_START.y,
      dir: 'left',
      nextDir: null,
      speed: PACMAN_SPEED,
    },
    ghosts: GHOST_STARTS.map( ( g ) => ( {
      x: g.x,
      y: g.y,
      startX: g.x,
      startY: g.y,
      dir: 'up',
      speed: GHOST_SPEED,
      type: g.type,
      state: 'inPen',
      mode: 'scatter',
      releaseTimer: GHOST_RELEASE_TIMERS[ g.type ],
      homeCorner: GHOST_CORNER[ g.type ],
    } ) ),
  };
}

function aligned( v ) {
  return Math.abs( v - Math.round( v ) ) < 1e-3;
}

// Centro de la celda hacia la que avanza el actor (según su dir), o null
// si aún no está lo bastante cerca como para clavarse en él. Evita que un
// fantasma avance en línea recta y cruce esquinas de muros cuando la
// velocidad (0.075 en frightened, 0.2 como ojos) no aterriza en enteros.
function cellCenterAhead( g ) {
  const d = DIRS[ g.dir ];
  const cx = d.x > 0 ? Math.ceil( g.x ) : d.x < 0 ? Math.floor( g.x ) : Math.round( g.x );
  const cy = d.y > 0 ? Math.ceil( g.y ) : d.y < 0 ? Math.floor( g.y ) : Math.round( g.y );
  if ( Math.abs( g.x - cx ) < g.speed && Math.abs( g.y - cy ) < g.speed ) {
    return { x: cx, y: cy };
  }
  return null;
}

// Realinea un actor a la celda transitable mas cercana a su posicion.
// Un round simple puede caer en un muro (pasillo de una celda de ancho);
// se prueban floor/ceil de ambos ejes y se elige la celda mas proxima.
function snapToGrid( grid, g ) {
  const xs = [ Math.floor( g.x ), Math.ceil( g.x ) ];
  const ys = [ Math.floor( g.y ), Math.ceil( g.y ) ];
  let best = null;
  let bestDist = Infinity;
  for ( const x of xs ) {
    for ( const y of ys ) {
      if ( isWall( grid, x, y, 'ghost' ) ) continue;
      const d = ( x - g.x ) * ( x - g.x ) + ( y - g.y ) * ( y - g.y );
      if ( d < bestDist ) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  if ( best ) {
    g.x = best.x;
    g.y = best.y;
  }
}

// Una celda es muro para el actor dado?
//   pacman: bloqueado por pared (1) y puerta (3)
//   ghost:  bloqueado solo por pared (1)
function isWall( grid, x, y, actor ) {
  if ( y < 0 || y >= grid.length ) return true;
  if ( x < 0 || x >= grid[ 0 ].length ) return true;
  const v = grid[ y ][ x ];
  if ( v === 1 ) return true;
  if ( v === 3 && actor === 'pacman' ) return true;
  return false;
}

// Puede el actor avanzar desde (x,y) en la direccion dir?
function canMove( grid, x, y, dir, actor ) {
  const d = DIRS[ dir ];
  if ( !d ) return false;
  const tx = x + d.x;
  const ty = y + d.y;
  // Tunel: salir por un borde en la fila del tunel siempre es valido.
  if ( ty === TUNNEL_ROW && ( tx < 0 || tx >= grid[ 0 ].length ) ) return true;
  return !isWall( grid, tx, ty, actor );
}

function wrapTunnel( a, width ) {
  if ( Math.round( a.y ) === TUNNEL_ROW ) {
    if ( a.x < 0 ) a.x += width;
    else if ( a.x >= width ) a.x -= width;
  }
}

// Celda n posiciones delante de Pac-Man hacia donde mira.
function aheadOf( p, n ) {
  const d = DIRS[ p.dir ] || { x: 0, y: 0 };
  return { x: Math.round( p.x ) + d.x * n, y: Math.round( p.y ) + d.y * n };
}

// Celda objetivo segun el tipo de fantasma.
function ghostTarget( game, g ) {
  const p = game.pacman;
  const px = Math.round( p.x );
  const py = Math.round( p.y );

  if ( g.type === 'blinky' ) return { x: px, y: py }; // persigue agresivo

  if ( g.type === 'pinky' ) return aheadOf( p, 4 ); // emboscador: 4 delante

  if ( g.type === 'inky' ) {
    // 2 delante + vector reflejado respecto a blinky.
    const pivot = aheadOf( p, 2 );
    const blinky = game.ghosts.find( ( other ) => other.type === 'blinky' ) || g;
    const bx = Math.round( blinky.x );
    const by = Math.round( blinky.y );
    return { x: 2 * pivot.x - bx, y: 2 * pivot.y - by };
  }

  // clyde: timido -> esquina propia si esta <= 8 celdas de Pac-Man.
  const gx = Math.round( g.x );
  const gy = Math.round( g.y );
  const dist = Math.sqrt( ( gx - px ) * ( gx - px ) + ( gy - py ) * ( gy - py ) );
  if ( dist <= 8 ) return { x: g.homeCorner.x, y: g.homeCorner.y };
  return { x: px, y: py };
}

function movePacman( game ) {
  const p = game.pacman;
  const grid = game.grid;
  const width = grid[ 0 ].length;

  if ( aligned( p.x ) && aligned( p.y ) ) {
    p.x = Math.round( p.x );
    p.y = Math.round( p.y );

    // Aplicar giro pendiente si es posible.
    if ( p.nextDir && canMove( grid, p.x, p.y, p.nextDir, 'pacman' ) ) {
      p.dir = p.nextDir;
      p.nextDir = null;
    }
    // Comer dot (10) o energizer (50 + frightened).
    const v = grid[ p.y ][ p.x ];
    if ( v === 2 ) {
      grid[ p.y ][ p.x ] = 0;
      game.score += 10;
      game.dotsRemaining--;
    } else if ( v === 4 ) {
      grid[ p.y ][ p.x ] = 0;
      game.score += 50;
      game.dotsRemaining--;
      activateFrightened( game );
    }
    // Si no puede seguir, se detiene en la celda.
    if ( !canMove( grid, p.x, p.y, p.dir, 'pacman' ) ) return;
  }

  const d = DIRS[ p.dir ];
  p.x += d.x * p.speed;
  p.y += d.y * p.speed;
  wrapTunnel( p, width );
}

// Elige entre las direcciones validas la que mas acerca a la celda target.
function pickDirTo( grid, g, target ) {
  const options = Object.keys( DIRS ).filter(
    ( dir ) => dir !== OPPOSITE[ g.dir ] && canMove( grid, g.x, g.y, dir, 'ghost' )
  );
  // Sin salida (callejon): permitir el giro de 180.
  const choices = options.length ? options : [ '' + OPPOSITE[ g.dir ] ];
  let best = choices[ 0 ];
  let bestDist = Infinity;
  for ( const dir of choices ) {
    const d = DIRS[ dir ];
    const nx = g.x + d.x;
    const ny = g.y + d.y;
    const dist = Math.abs( nx - target.x ) + Math.abs( ny - target.y );
    if ( dist < bestDist ) {
      bestDist = dist;
      best = dir;
    }
  }
  return best;
}

function decideGhost( game, g ) {
  const grid = game.grid;

  if ( g.mode === 'frightened' ) {
    // Movimiento erratico: direccion aleatoria entre las validas.
    const options = Object.keys( DIRS ).filter(
      ( dir ) => dir !== OPPOSITE[ g.dir ] && canMove( grid, g.x, g.y, dir, 'ghost' )
    );
    // Sin salida (callejon): permitir el giro de 180.
    const choices = options.length ? options : [ '' + OPPOSITE[ g.dir ] ];
    g.dir = choices[ Math.floor( Math.random() * choices.length ) ];
    return;
  }

  // eyes: volver a la entrada del pen; chase/scatter: perseguir su target.
  const target = g.mode === 'eyes' ? PEN_ENTRANCE : ghostTarget( game, g );
  g.dir = pickDirTo( grid, g, target );
}

function moveGhost( game, g ) {
  const grid = game.grid;
  const width = grid[ 0 ].length;

  // En espera dentro del pen no se mueve.
  if ( g.state === 'inPen' || g.state === 'backInPen' ) return;

  const center = cellCenterAhead( g );
  if ( center ) {
    g.x = center.x;
    g.y = center.y;

    if ( g.state === 'eyesReturning' ) {
      // Llego a su celda de inicio dentro del pen: se reintegra.
      if ( g.x === g.startX && g.y === g.startY ) {
        reintegrateGhost( game, g );
        return;
      }
      // En la entrada del pen baja por la puerta...
      if ( g.x === PEN_ENTRANCE.x && g.y === PEN_ENTRANCE.y ) {
        g.dir = 'down';
        if ( !canMove( grid, g.x, g.y, g.dir, 'ghost' ) ) return;
      } else {
        // Dentro del pen (paso la puerta): ir a la celda de inicio.
        const target = g.y > PEN_ENTRANCE.y ? { x: g.startX, y: g.startY } : PEN_ENTRANCE;
        g.dir = pickDirTo( grid, g, target );
        if ( !canMove( grid, g.x, g.y, g.dir, 'ghost' ) ) return;
      }
    } else if ( g.state === 'exiting' ) {
      // Sale del pen siempre hacia arriba y se activa al rebasar la puerta.
      if ( g.y === PEN_ENTRANCE.y ) {
        g.state = 'active';
        decideGhost( game, g );
        if ( !canMove( grid, g.x, g.y, g.dir, 'ghost' ) ) return;
      } else {
        g.dir = 'up';
        if ( !canMove( grid, g.x, g.y, g.dir, 'ghost' ) ) return;
      }
    } else {
      decideGhost( game, g );
      if ( !canMove( grid, g.x, g.y, g.dir, 'ghost' ) ) return;
    }
  }

  const d = DIRS[ g.dir ];
  g.x += d.x * g.speed;
  g.y += d.y * g.speed;
  wrapTunnel( g, width );
}

function resetPositions( game ) {
  const p = game.pacman;
  p.x = PACMAN_START.x;
  p.y = PACMAN_START.y;
  p.dir = 'left';
  p.nextDir = null;
  game.ghosts.forEach( ( g, i ) => {
    g.x = GHOST_STARTS[ i ].x;
    g.y = GHOST_STARTS[ i ].y;
    g.dir = 'up';
  } );
}

function collides( a, b ) {
  return Math.abs( a.x - b.x ) < 0.5 && Math.abs( a.y - b.y ) < 0.5;
}

// Avanza los temporizadores globales y por fantasma una cantidad de frames.
function advanceGhostModes( game, frames ) {
  // Scheduler global Scatter/Chase (congelado mientras dura frightened).
  if ( game.ghostMode !== 'frightened' ) {
    game.ghostModeTimer += frames;
    const current = game.ghostModeQueue[ 0 ];
    if ( current && game.ghostModeTimer >= current.frames ) {
      game.ghostModeTimer = 0;
      game.ghostModeQueue.shift();
      const next = game.ghostModeQueue[ 0 ];
      if ( next ) {
        game.ghostMode = next.mode;
        game.ghosts.forEach( ( g ) => {
          if ( g.state === 'active' && g.mode !== 'eyes' ) g.mode = next.mode;
        } );
      }
    }
  }

  game.ghosts.forEach( ( g ) => {
    // Espera en el pen: primera salida y reaparicion tras volver como ojos.
    if ( g.state === 'inPen' || g.state === 'backInPen' ) {
      g.releaseTimer -= frames;
      if ( g.releaseTimer <= 0 ) {
        g.releaseTimer = 0;
        g.state = 'exiting';
        // Durante frightened la liberacion no vuelve azul al fantasma:
        // hereda el modo real del scheduler guardado.
        g.mode = game.ghostModeSaved ? game.ghostModeSaved.mode : game.ghostMode;
        g.speed = GHOST_SPEED;
      }
      return;
    }

    // Modo azul: cuenta atras hasta volver como ojos.
    if ( g.mode === 'frightened' ) {
      g.frightenedTimer -= frames;
      if ( g.frightenedTimer <= 0 ) {
        g.frightenedTimer = 0;
        g.mode = 'eyes';
        g.state = 'eyesReturning';
        g.speed = EYES_SPEED;
        // Realinear al centro de celda: si la velocidad cambia a mitad de
        // camino, un desfase deja al ojo sin pillar nunca un entero.
        snapToGrid( game.grid, g );
      }
    }
  } );
}

function reintegrateGhost( game, g ) {
  g.state = 'backInPen';
  g.releaseTimer = GHOST_RELEASE_TIMERS[ g.type ];
  g.mode = 'scatter';
  g.speed = GHOST_SPEED;

  // Reanudar el scheduler guardado cuando ya no queda ningun frightened.
  if ( game.ghostMode === 'frightened' && game.ghostModeSaved ) {
    game.ghostMode = game.ghostModeSaved.mode;
    game.ghostModeTimer = game.ghostModeSaved.timer;
    game.ghostModeSaved = null;
  }
}

// Comer un energizer: pausa el scheduler y vuelve azules a los activos.
function activateFrightened( game ) {
  if ( game.ghostMode === 'frightened' ) return; // evitar encadenar
  game.ghostModeSaved = { mode: game.ghostMode, timer: game.ghostModeTimer };
  game.ghostMode = 'frightened';
  game.ghosts.forEach( ( g ) => {
    if ( g.state === 'active' ) {
      g.mode = 'frightened';
      g.frightenedTimer = GHOST_FRIGHTENED_DURATION;
      g.speed = FRIGHTENED_SPEED;
      snapToGrid( game.grid, g );
    }
  } );
}

function update( game ) {
  advanceGhostModes( game, 1 );
  movePacman( game );
  game.ghosts.forEach( ( g ) => moveGhost( game, g ) );

  for ( const g of game.ghosts ) {
    if ( collides( game.pacman, g ) ) {
      if ( g.mode === 'frightened' ) {
        // Comer un fantasma azul: vuelve como ojos, sin perder vida.
        g.mode = 'eyes';
        g.state = 'eyesReturning';
        g.speed = EYES_SPEED;
        snapToGrid( game.grid, g );
      } else if ( g.mode === 'eyes' ) {
        // Los ojos son inofensivos: se ignora la colision.
        continue;
      } else {
        game.lives--;
        if ( game.lives <= 0 ) {
          game.state = 'lost';
          return;
        }
        resetPositions( game );
      }
      break;
    }
  }

  if ( game.dotsRemaining <= 0 ) game.state = 'won';
}

window.createGame = createGame;
window.update = update;
window.DIRS = DIRS;
