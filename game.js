// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('board');
const ctx      = canvas.getContext('2d');
const nextCvs  = document.getElementById('next-canvas');
const nextCtx  = nextCvs.getContext('2d');
const holdCvs  = document.getElementById('hold-canvas');
const holdCtx  = holdCvs.getContext('2d');

const COLS = 10, ROWS = 20, BUFFER = 3; // BUFFER = hidden rows above visible area
const TOTAL_ROWS = ROWS + BUFFER;
let CELL = 28;

function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const hdrH = vw >= 600 ? 60 : 52;
  const pad  = 12;
  // Desktop: side panels scale with vw (clamp 80-140px) + 8px gap each
  // Mobile:  fixed 60px + 8px gap each
  const isDesktop = vw >= 600 && window.matchMedia('(pointer:fine)').matches;
  const panelW = isDesktop ? Math.min(140, Math.max(80, Math.floor(vw * 0.10))) : 60;
  const sideW  = panelW + 8;
  const bar = document.getElementById('btn-bar');
  const btnBarH = (bar && bar.classList.contains('visible')) ? (bar.offsetHeight || 152) : 0;
  const availH = vh - hdrH - pad - btnBarH;
  const availW = vw - sideW * 2 - pad;
  CELL = Math.max(14, Math.min(Math.floor(availH / ROWS), Math.floor(availW / COLS)));
  canvas.width  = CELL * COLS;
  canvas.height = CELL * ROWS;
  // Sync side panel DOM width so layout matches
  document.querySelectorAll('.side-panel').forEach(p => {
    p.style.width = panelW + 'px';
    p.style.minWidth = panelW + 'px';
  });
  resizeViz();
  draw();
}

// ── Piece definitions ─────────────────────────────────────────────────────────
const COLORS = { I:'#00f5ff', O:'#ffbe0b', T:'#cc44ff', S:'#00ff88', Z:'#ff4466', J:'#4488ff', L:'#ff8800' };
const GHOST  = 'rgba(255,255,255,0.32)';
const SHAPES = {
  I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O:[[1,1],[1,1]],
  T:[[0,1,0],[1,1,1],[0,0,0]],
  S:[[0,1,1],[1,1,0],[0,0,0]],
  Z:[[1,1,0],[0,1,1],[0,0,0]],
  J:[[1,0,0],[1,1,1],[0,0,0]],
  L:[[0,0,1],[1,1,1],[0,0,0]]
};

// ── SRS Wall Kick Tables (Official Tetris Guideline) ─────────────────────────
// States: 0=spawn, 1=CW, 2=180, 3=CCW
// Each entry: kicks to try for that rotation transition [dx, dy] (dy positive = UP in game = negative in canvas)
// JLSTZ pieces share one table; I piece has its own
const KICKS_JLSTZ = {
  '0>1': [[ 0,0],[-1,0],[-1, 1],[0,-2],[-1,-2]],
  '1>0': [[ 0,0],[ 1,0],[ 1,-1],[0, 2],[ 1, 2]],
  '1>2': [[ 0,0],[ 1,0],[ 1,-1],[0, 2],[ 1, 2]],
  '2>1': [[ 0,0],[-1,0],[-1, 1],[0,-2],[-1,-2]],
  '2>3': [[ 0,0],[ 1,0],[ 1, 1],[0,-2],[ 1,-2]],
  '3>2': [[ 0,0],[-1,0],[-1,-1],[0, 2],[-1, 2]],
  '3>0': [[ 0,0],[-1,0],[-1,-1],[0, 2],[-1, 2]],
  '0>3': [[ 0,0],[ 1,0],[ 1, 1],[0,-2],[ 1,-2]],
};
const KICKS_I = {
  '0>1': [[ 0,0],[-2,0],[ 1,0],[-2,-1],[ 1, 2]],
  '1>0': [[ 0,0],[ 2,0],[-1,0],[ 2, 1],[-1,-2]],
  '1>2': [[ 0,0],[-1,0],[ 2,0],[-1, 2],[ 2,-1]],
  '2>1': [[ 0,0],[ 1,0],[-2,0],[ 1,-2],[-2, 1]],
  '2>3': [[ 0,0],[ 2,0],[-1,0],[ 2, 1],[-1,-2]],
  '3>2': [[ 0,0],[-2,0],[ 1,0],[-2,-1],[ 1, 2]],
  '3>0': [[ 0,0],[ 1,0],[-2,0],[ 1,-2],[-2, 1]],
  '0>3': [[ 0,0],[-1,0],[ 2,0],[-1, 2],[ 2,-1]],
};

function rotateCW(matrix) {
  const N = matrix.length;
  return matrix[0].map((_, c) => matrix.map((_, r) => matrix[N-1-r][c]));
}
function rotateCCW(matrix) {
  // True inverse of CW: applying CW three times = one CCW
  return rotateCW(rotateCW(rotateCW(matrix)));
}

function tryRotateSRS(dir) { // dir: 1=CW, -1=CCW
  const fromState = current.rotState;
  const toState   = ((fromState + dir) % 4 + 4) % 4;
  const key       = `${fromState}>${toState}`;
  const newMatrix = dir === 1 ? rotateCW(current.matrix) : rotateCCW(current.matrix);
  const kicks     = (current.type === 'I' ? KICKS_I : current.type === 'O' ? [[0,0]] : KICKS_JLSTZ)[key] || [[0,0]];
  for (let ki = 0; ki < kicks.length; ki++) {
    const [dx, dy] = kicks[ki];
    if (valid(current, dx, -dy, newMatrix)) {
      current.matrix   = newMatrix;
      current.x       += dx;
      current.y       -= dy;
      current.rotState = toState;
      lastKickIdx      = ki;
      // T-spin detection: 3-corner rule + grounded
      // Piece must be a T, grounded after rotation, and ≥3 of the 4 corners of
      // the 3×3 bounding box occupied by blocks or walls (floor/sides count; no ceiling).
      if (current.type === 'T' && !valid(current, 0, 1)) {
        const corners = [[0,0],[0,2],[2,0],[2,2]];
        let filled = 0;
        corners.forEach(([dr, dc]) => {
          const nr = current.y + dr, nc = current.x + dc;
          if (nc < 0 || nc >= COLS || nr >= TOTAL_ROWS ||
              (nr >= 0 && board[nr][nc] !== null)) filled++;
        });
        lastWasTSpin = filled >= 3;
      } else {
        lastWasTSpin = false;
      }
      resetLock();
      return;
    }
  }
  lastWasTSpin = false;
}

// ── Settings ──────────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'tetris_settings';
let settings = { vibration: true, repeatDelay: 200, repeatSpeed: 80, lockDelay: 500, touchSensitivity: 30, musicOn: true, musicVolume: 100, edcMode: false, onscreenButtons: false };
// touchSensitivity = pixels of horizontal drag required to move one column (higher = less sensitive)

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s) settings = { ...settings, ...s };
  } catch(e) {}
  applySettingsUI();
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(e) {}
}

// ── Leaderboard (localStorage top-5) ─────────────────────────────────────────
const HS_KEY = 'tetris_leaderboard';

function loadLeaderboard() {
  try {
    const d = JSON.parse(localStorage.getItem(HS_KEY));
    return Array.isArray(d) ? d : [];
  } catch(e) { return []; }
}

function saveLeaderboard(board) {
  try { localStorage.setItem(HS_KEY, JSON.stringify(board)); } catch(e) {}
}

function getBestScore() {
  const lb = loadLeaderboard();
  return lb.length ? lb[0].score : 0;
}

function qualifiesForTop5(score) {
  if (score <= 0) return false;
  const lb = loadLeaderboard();
  return lb.length < 5 || score > lb[lb.length - 1].score;
}

function insertScore(tag, score) {
  const lb = loadLeaderboard();
  const date = new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  lb.push({ tag: (tag||'???').toUpperCase().slice(0,3), score, date });
  lb.sort((a,b) => b.score - a.score);
  lb.splice(5); // keep top 5
  saveLeaderboard(lb);
  highScore = getBestScore();
  updateUI();
}

function renderLeaderboard() {
  const lb = loadLeaderboard();
  const el = document.getElementById('leaderboard-list');
  if (!lb.length) {
    el.innerHTML = '<div style="font-size:clamp(7px,1.5vw,10px);color:var(--dim);text-align:center;padding:16px 0">NO SCORES YET.<br>PLAY A GAME!</div>';
    return;
  }
  const medals = ['🥇','🥈','🥉','4','5'];
  el.innerHTML = lb.map((e,i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;
                background:rgba(255,255,255,0.04);border-radius:4px;
                border:1px solid rgba(255,255,255,0.07)">
      <span style="font-size:clamp(8px,1.6vw,12px);min-width:20px;text-align:center">${medals[i]}</span>
      <span style="font-size:clamp(9px,2vw,14px);color:var(--glow-cyan);
                   text-shadow:0 0 6px var(--glow-cyan);min-width:38px;letter-spacing:0.1em">${e.tag}</span>
      <span style="font-size:clamp(9px,2vw,13px);color:var(--glow-yellow);
                   text-shadow:0 0 6px var(--glow-yellow);flex:1;text-align:right">${e.score.toLocaleString()}</span>
      <span style="font-size:clamp(5px,1.1vw,8px);color:var(--dim);min-width:60px;text-align:right">${e.date}</span>
    </div>`).join('');
}

function openLeaderboard() {
  renderLeaderboard();
  document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
  document.getElementById('leaderboard-screen').classList.remove('hidden');
}

let highScore = 0;

// ── Game state snapshot (resume after app close) ───────────────────────────────
const SNAPSHOT_KEY = 'tetris_snapshot';

function saveSnapshot() {
  if (!gameRunning) return;
  try {
    const snap = {
      board, current, nextPieces, held, canHold,
      score, level, lines, bag,
      combo, backToBack, lastWasTSpin, lastKickIdx,
      isLocking, lockTimer, lockMoves, dropCounter,
      ts: Date.now()
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch(e) {}
}

function clearSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch(e) {}
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // Discard snapshots older than 24 hours
    if (Date.now() - (snap.ts || 0) > 86400000) { clearSnapshot(); return null; }
    return snap;
  } catch(e) { return null; }
}

function hasSavedGame() { return !!loadSnapshot(); }

function resumeGame() {
  const snap = loadSnapshot();
  if (!snap) return;
  board       = snap.board;
  current     = snap.current;
  nextPieces  = snap.nextPieces;
  held        = snap.held;
  canHold     = snap.canHold;
  score       = snap.score;
  level       = snap.level;
  lines       = snap.lines;
  bag         = snap.bag || [];
  combo       = snap.combo || 0;
  backToBack  = snap.backToBack || false;
  lastWasTSpin  = snap.lastWasTSpin || false;
  lastKickIdx   = snap.lastKickIdx ?? -1;
  isLocking   = snap.isLocking || false;
  lockTimer   = snap.lockTimer || 0;
  lockMoves   = snap.lockMoves || 0;
  dropCounter = 0; // reset drop counter so piece doesn't instantly fall
  lastTime    = 0;
  gameRunning = true;
  paused      = false;
  hideComboIndicator();
  updateUI();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
  // Show pause screen immediately so player can orient themselves
  togglePause();
  clearSnapshot(); // will be re-saved on next background
}

function updateResumeBtn() {
  const btn = document.getElementById('resume-saved-btn');
  if (hasSavedGame()) btn.classList.remove('hidden');
  else btn.classList.add('hidden');
}

// ── Vibration ─────────────────────────────────────────────────────────────────
// Android: navigator.vibrate
// iOS: AudioContext short sine burst (best available — iOS has no vibrate API)
// iPadOS 13+ reports as MacIntel with maxTouchPoints > 1, so detect that too.
const _isIOS = (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
               !window.MSStream;
let _vibAudioCtx = null;

function _ensureVibAudio() {
  if (!_vibAudioCtx) {
    try { _vibAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  if (_vibAudioCtx && _vibAudioCtx.state === 'suspended') {
    _vibAudioCtx.resume().catch(() => {});
  }
}

// iOS haptic: plays a very short, nearly-inaudible sine burst.
// A sharp audio impulse through the WebAudio API is the only available
// trigger for the Taptic Engine in mobile Safari.
function _playIosHapticBurst(count, intensity) {
  if (!_vibAudioCtx || _vibAudioCtx.state !== 'running') return;
  try {
    for (let i = 0; i < count; i++) {
      const t   = _vibAudioCtx.currentTime + i * 0.07;
      const osc = _vibAudioCtx.createOscillator();
      const g   = _vibAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 200;
      // Sharp attack, fast decay — mimics a click impulse
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(intensity * 0.12, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(g);
      g.connect(_vibAudioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.045);
    }
  } catch(e) {}
}

function _iosHaptic(count, intensity) {
  if (!_vibAudioCtx) return;
  if (_vibAudioCtx.state === 'suspended') {
    _vibAudioCtx.resume().then(() => _playIosHapticBurst(count, intensity)).catch(() => {});
  } else {
    _playIosHapticBurst(count, intensity);
  }
}

function vib(pattern, count, intensity) {
  if (!settings.vibration) return;
  // Try navigator.vibrate first (works on Android; no-op on iOS but harmless)
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch(e) {}
  }
  // iOS fallback: AudioContext impulse (only meaningful path on iOS)
  if (_isIOS) {
    _ensureVibAudio();
    _iosHaptic(count || 1, intensity || 1.0);
  }
}

function vibMove()   { vib(25,  1, 0.9); }
function vibRotate() { vib(30,  1, 1.0); }
function vibDrop()   { vib([30,15,30], 2, 1.0); }
function vibLine()   { vib(50, 3, 1.0); }
function vibBest()   { vib([80,40,80,40,150], 5, 1.0); }

// ── Combo & bonus state ───────────────────────────────────────────────────────
let combo = 0;          // consecutive clears counter (resets on no-clear lock)
let backToBack = false; // true after a Tetris or T-spin clear
let lastWasTSpin = false; // set by tryRotateSRS if last rotation was a T-spin
let lastKickIdx = -1;   // wall kick index used for last rotation
let comboFadeTimer = null;

function showComboIndicator(label, pts) {
  const box = document.getElementById('combo-box');
  document.getElementById('combo-label').textContent = label;
  document.getElementById('combo-pts').textContent = pts ? '+'+pts : '';
  box.style.opacity = '1';
  if (comboFadeTimer) clearTimeout(comboFadeTimer);
  comboFadeTimer = setTimeout(() => {
    box.style.opacity = '0';
  }, 1800);
}
function hideComboIndicator() {
  if (comboFadeTimer) clearTimeout(comboFadeTimer);
  document.getElementById('combo-box').style.opacity = '0';
}
let board, current, nextPieces, held, canHold;
let score, level, lines, gameRunning, paused, animId;
let bag = [];

function initGame(startLevel = 1) {
  board = Array.from({length:TOTAL_ROWS}, () => Array(COLS).fill(null));
  bag = [];
  score = 0;
  level = Math.max(1, Math.min(20, Math.floor(startLevel)));
  lines = (level - 1) * 10;
  held = null; canHold = true;
  isLocking = false; lockTimer = 0; lockMoves = 0;
  dropCounter = 0; lastTime = 0;
  combo = 0; backToBack = false; lastWasTSpin = false; lastKickIdx = -1;
  hideComboIndicator();
  nextPieces = [spawnPiece(), spawnPiece(), spawnPiece()];
  current = shiftNext();
  gameRunning = true; paused = false;
  updateUI();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
  Music.restart();
  if (settings.musicOn) Music.play();
  updateBtnBar();
}

function refillBag() {
  const types = Object.keys(SHAPES);
  for (let i = types.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [types[i],types[j]] = [types[j],types[i]];
  }
  bag.push(...types);
}

function spawnPiece(type) {
  if (!type) { if (bag.length===0) refillBag(); type = bag.shift(); }
  return { type, matrix: SHAPES[type].map(r=>[...r]), x: Math.floor(COLS/2)-Math.floor(SHAPES[type][0].length/2), y: BUFFER, rotState: 0 };
}

// Spawn 1 row higher when the board is stacked into the top 2 visible rows,
// giving the player room to maneuver before the game-over condition triggers.
function getSpawnY() {
  for (let c = 0; c < COLS; c++) {
    if (board[BUFFER][c] || board[BUFFER + 1][c]) return BUFFER - 1;
  }
  return BUFFER;
}

function shiftNext() {
  const p = nextPieces.shift();
  nextPieces.push(spawnPiece());
  return p;
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let lastTime = 0, dropCounter = 0;
let lockTimer = 0, isLocking = false, lockMoves = 0;
const LOCK_MAX_MOVES = 15;
function lockDelay() { return settings.lockDelay; }

// NES Tetris speed table for levels 1-21, then exponential decay beyond that.
// Levels 1-21 follow the classic NES curve (800ms → 17ms).
// Levels 22+ decay at 7% per level toward a 2ms minimum so speed keeps scaling
// to ~level 50 where a piece traverses the board in ~40ms (barely visible).
function dropInterval() {
  const nesFrames = [48,43,38,33,28,23,18,13,8,6,5,5,5,4,4,4,3,3,3,2,1];
  const idx = level - 1;
  if (idx < nesFrames.length) return nesFrames[idx] * (1000 / 60);
  const base = nesFrames[nesFrames.length - 1] * (1000 / 60); // ~17ms at level 21
  return Math.max(2, base * Math.pow(0.93, idx - (nesFrames.length - 1)));
}

function loop(time=0) {
  // On the very first frame after initGame, lastTime=0 but time is a large RAF timestamp.
  // Cap delta to avoid a huge first-frame jump that instantly triggers lock/drop.
  const delta = lastTime === 0 ? 0 : Math.min(time - lastTime, 100);
  lastTime = time;
  updateViz(time);

  if (!paused && gameRunning) {
    dropCounter += delta;

    const grounded = !valid(current, 0, 1);

    if (grounded) {
      if (!isLocking) { isLocking = true; lockTimer = 0; }
      lockTimer += delta;
      if (lockTimer >= lockDelay()) {
        // If piece is still in an invalid position (spawn-blocked), end the game
        if (!valid(current, 0, 0)) { endGame(); return; }
        lock();
      }
    } else {
      isLocking = false; lockTimer = 0;
      const di = dropInterval();
      if (di >= 1000 / 60) {
        // Normal speed: at most one drop per frame trigger
        if (dropCounter >= di) { moveDown(); dropCounter -= di; }
      } else {
        // Sub-frame speed (level 21+): drop multiple rows per frame
        while (dropCounter >= di) {
          moveDown();
          dropCounter -= di;
          if (!valid(current, 0, 1)) break;
        }
      }
    }

    draw();
  }
  animId = requestAnimationFrame(loop);
}

// ── Movement ──────────────────────────────────────────────────────────────────
function valid(piece, dx=0, dy=0, mat=null) {
  const m = mat || piece.matrix;
  for (let r=0; r<m.length; r++) for (let c=0; c<m[r].length; c++) {
    if (!m[r][c]) continue;
    const nx=piece.x+c+dx, ny=piece.y+r+dy;
    if (nx<0||nx>=COLS||ny>=TOTAL_ROWS) return false;
    if (ny>=0 && board[ny][nx]) return false;
  }
  return true;
}

function tryRotate()     { tryRotateSRS( 1); }
function tryRotateLeft() { tryRotateSRS(-1); }

function moveLeft()  { if (valid(current,-1,0)) { current.x--; lastWasTSpin=false; resetLock(); } }
function moveRight() { if (valid(current, 1,0)) { current.x++; lastWasTSpin=false; resetLock(); } }

function resetLock() {
  // Reset lock timer when player moves/rotates while grounded, up to max resets
  if (isLocking && lockMoves < LOCK_MAX_MOVES) {
    lockTimer = 0;
    lockMoves++;
  }
}

function moveDown() {
  if (valid(current,0,1)) {
    current.y++;
    isLocking = false; lockTimer = 0; // moved down, reset lock
  }
  // if not valid downward, loop will handle locking via lockTimer
}

function hardDrop() {
  let d=0; while (valid(current,0,d+1)) d++;
  current.y+=d; score+=d*2; updateUI();
  lock(); dropCounter=0;
}

function hold() {
  if (!canHold) return;
  const spawnY = getSpawnY();
  if (held) {
    const tmp = held;
    held = { type:current.type, matrix: SHAPES[current.type].map(r=>[...r]), rotState:0 };
    current = { ...tmp, x:Math.floor(COLS/2)-Math.floor(tmp.matrix[0].length/2), y:spawnY, rotState:0 };
  } else {
    held = { type:current.type, matrix: SHAPES[current.type].map(r=>[...r]), rotState:0 };
    current = shiftNext();
    current.y = spawnY;
  }
  canHold = false;
  // Clear spawn-blocked lock state on hold swap
  if (valid(current, 0, 0)) { isLocking = false; lockTimer = 0; }
}

// Called after cleared rows are removed (or immediately if no rows cleared)
function afterClear() {
  const next = shiftNext();
  canHold = true;
  current = next;
  current.y = getSpawnY();
  if (!valid(current, 0, 0)) {
    isLocking = true;
    lockTimer = 0;
  }
}

function lock() {
  // Check lock-out: piece locked entirely in the buffer zone (above visible area)
  let allAbove = true;
  for (let r=0; r<current.matrix.length; r++) for (let c=0; c<current.matrix[r].length; c++) {
    if (!current.matrix[r][c]) continue;
    const ny = current.y+r;
    if (ny >= BUFFER) allAbove = false;
    if (ny < 0) { endGame(); return; } // truly off the top of the board
    board[ny][current.x+c] = current.type;
  }
  isLocking = false; lockTimer = 0; lockMoves = 0;

  // If the piece locked entirely above the visible area, game over
  if (allAbove) { endGame(); return; }

  clearLines();
}

function clearLines() {
  // Detect full rows without modifying board yet
  const rows = [];
  for (let r = TOTAL_ROWS - 1; r >= 0; r--) {
    if (board[r].every(c => c !== null)) rows.push(r);
  }

  if (!rows.length) {
    combo = 0;
    lastWasTSpin = false;
    afterClear();
    return;
  }

  const cleared = rows.length;

  // ── Detect specials ───────────────────────────────────────────────────────
  const isTSpin   = lastWasTSpin;
  const isTetris  = cleared === 4;
  const isSpecial = isTSpin || isTetris;
  // isAllClear: after removing these rows, are all remaining rows empty?
  const rowSet = new Set(rows);
  const isAllClear = board.every((row, i) => rowSet.has(i) || row.every(c => c === null));

  // ── Base points (Guideline) ───────────────────────────────────────────────
  let baseLabel = '';
  let basePts = 0;
  if (isTSpin) {
    const tspinPts = [0, 800, 1200, 1600];
    basePts = (tspinPts[cleared] || 1600) * level;
    baseLabel = cleared === 1 ? 'T-SPIN\nSINGLE' : cleared === 2 ? 'T-SPIN\nDOUBLE' : 'T-SPIN\nTRIPLE';
  } else {
    const pts = [0, 100, 300, 500, 800];
    basePts = (pts[cleared] || 800) * level;
    baseLabel = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS!'][cleared] || '';
  }

  // ── Back-to-back bonus (+50% on top) ─────────────────────────────────────
  const wasB2B = backToBack;
  let b2bBonus = 0;
  if (isSpecial && wasB2B) {
    b2bBonus = Math.floor(basePts * 0.5);
    baseLabel = 'B2B ' + baseLabel;
  }
  backToBack = isSpecial;

  // ── Combo bonus ───────────────────────────────────────────────────────────
  combo++;
  const comboBonus = combo >= 2 ? 50 * (combo - 1) * level : 0;

  // ── All-clear (perfect clear) bonus — Guideline values by clear count ─────
  // Single:800 Double:1200 Triple:1800 Tetris:2000 B2B-Tetris:3200 (all × level)
  const acPts = [0, 800, 1200, 1800, 2000];
  const allClearBonus = isAllClear
    ? (isTetris && wasB2B ? 3200 : (acPts[cleared] || 2000)) * level
    : 0;
  if (isAllClear) baseLabel = 'ALL\nCLEAR!';

  // ── Apply total score ─────────────────────────────────────────────────────
  const totalBonus = basePts + b2bBonus + comboBonus + allClearBonus;
  score += totalBonus;
  lines += cleared;
  level = Math.floor(lines / 10) + 1;
  vibLine();
  if (score > highScore) { highScore = getBestScore(); }
  updateUI();

  // ── Build indicator text ──────────────────────────────────────────────────
  let indicatorLabel = baseLabel;
  let indicatorPts   = totalBonus;
  if (!isTSpin && !isTetris && !isAllClear && combo >= 2) {
    indicatorLabel = combo + 'x COMBO!';
  }
  if (indicatorLabel) showComboIndicator(indicatorLabel, indicatorPts);
  lastWasTSpin = false;

  // ── Remove cleared rows then add empty rows at top ───────────────────────
  // Must separate splice and unshift: interleaving them shifts row indices
  // mid-loop, causing subsequent splices to remove the wrong rows.
  rows.slice().sort((a, b) => b - a).forEach(r => board.splice(r, 1));
  for (let i = 0; i < rows.length; i++) board.unshift(Array(COLS).fill(null));
  afterClear();
}

function endGame() {
  gameRunning = false;
  updateBtnBar();
  if (settings.musicOn) Music.play();
  else Music.pause();
  clearSnapshot(); // game ended naturally — no resume needed
  updateResumeBtn();
  const best = getBestScore();
  const isNew = score > 0 && score > best;
  if (isNew) vibBest();

  document.getElementById('final-score').textContent = 'SCORE: ' + score.toLocaleString();
  document.getElementById('new-best').classList.toggle('hidden', !isNew);

  // Show tag entry only if score qualifies for top 5
  const tagEntry = document.getElementById('tag-entry');
  if (qualifiesForTop5(score)) {
    tagEntry.classList.remove('hidden');
    tagEntry.style.display = 'flex';
    const inp = document.getElementById('tag-input');
    inp.value = '';
    setTimeout(() => inp.focus(), 100);
  } else {
    tagEntry.classList.add('hidden');
    tagEntry.style.display = 'none';
  }

  document.getElementById('gameover-screen').classList.remove('hidden');
}

// ── Drawing ───────────────────────────────────────────────────────────────────
function drawCell(c, x, y, isGhost=false, alpha=1) {
  const px=x*CELL, py=y*CELL;
  if (isGhost) {
    ctx.fillStyle=GHOST;
    ctx.fillRect(px+1,py+1,CELL-2,CELL-2);
    return;
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle=COLORS[c];
  ctx.fillRect(px+1,py+1,CELL-2,CELL-2);
  ctx.fillStyle='rgba(255,255,255,0.22)';
  ctx.fillRect(px+2,py+2,CELL-4,3);
  ctx.fillStyle='rgba(0,0,0,0.28)';
  ctx.fillRect(px+2,py+CELL-5,CELL-4,3);
  ctx.globalAlpha = 1;
}

function ghostY() {
  let g=0; while (valid(current,0,g+1)) g++;
  return current.y+g;
}

function draw(time) {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Semi-transparent background so EDC effects bleed through
  ctx.fillStyle = 'rgba(8,14,32,0.5)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // Grid
  ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
  for (let r=0;r<ROWS;r++) { ctx.beginPath(); ctx.moveTo(0,r*CELL); ctx.lineTo(canvas.width,r*CELL); ctx.stroke(); }
  for (let c=0;c<COLS;c++) { ctx.beginPath(); ctx.moveTo(c*CELL,0); ctx.lineTo(c*CELL,canvas.height); ctx.stroke(); }
  // Board — offset by BUFFER so hidden rows don't render
  if (board) {
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (board[r+BUFFER][c]) drawCell(board[r+BUFFER][c],c,r);
  }
  // Ghost + current — subtract BUFFER from y for canvas coords
  if (gameRunning && current) {
    const gy=ghostY();
    if (gy!==current.y)
      for (let r=0;r<current.matrix.length;r++) for (let c=0;c<current.matrix[r].length;c++)
        if (current.matrix[r][c]) drawCell(current.type, current.x+c, gy+r-BUFFER, true);
    for (let r=0;r<current.matrix.length;r++) for (let c=0;c<current.matrix[r].length;c++)
      if (current.matrix[r][c]) {
        const cy = current.y+r-BUFFER;
        if (cy >= 0) drawCell(current.type, current.x+c, cy); // only draw if in visible area
      }
  }
  if (nextPieces) drawNext();
  drawMini(holdCtx, held, holdCvs.width, holdCvs.height);
}

function drawNext() {
  nextCtx.clearRect(0,0,nextCvs.width,nextCvs.height);
  if (!nextPieces.length) return;
  const slotH = Math.floor(nextCvs.height / 3);
  nextPieces.forEach((piece, i) => {
    const m = piece.matrix;
    const cs = Math.min(Math.floor(nextCvs.width/(m[0].length+1)), Math.floor(slotH/(m.length+1)));
    const ox = Math.floor((nextCvs.width - m[0].length*cs)/2);
    const oy = i*slotH + Math.floor((slotH - m.length*cs)/2);
    // Dim older pieces slightly
    nextCtx.globalAlpha = i===0 ? 1 : i===1 ? 0.7 : 0.45;
    for (let r=0;r<m.length;r++) for (let c=0;c<m[r].length;c++) {
      if (!m[r][c]) continue;
      const px=ox+c*cs, py=oy+r*cs;
      nextCtx.fillStyle=COLORS[piece.type];
      nextCtx.fillRect(px+1,py+1,cs-2,cs-2);
      nextCtx.fillStyle='rgba(255,255,255,0.2)';
      nextCtx.fillRect(px+2,py+2,cs-4,2);
    }
  });
  nextCtx.globalAlpha=1;
  // Dividers
  nextCtx.strokeStyle='rgba(255,255,255,0.06)'; nextCtx.lineWidth=1;
  for (let i=1;i<3;i++) {
    nextCtx.beginPath(); nextCtx.moveTo(4,i*slotH); nextCtx.lineTo(nextCvs.width-4,i*slotH); nextCtx.stroke();
  }
}

function drawMini(mctx, piece, w, h) {
  mctx.clearRect(0,0,w,h);
  if (!piece) return;
  const m=piece.matrix;
  const cs=Math.min(Math.floor(w/(m[0].length+1)),Math.floor(h/(m.length+1)));
  const ox=Math.floor((w-m[0].length*cs)/2);
  const oy=Math.floor((h-m.length*cs)/2);
  for (let r=0;r<m.length;r++) for (let c=0;c<m[r].length;c++) {
    if (!m[r][c]) continue;
    const px=ox+c*cs, py=oy+r*cs;
    mctx.fillStyle=COLORS[piece.type]; mctx.fillRect(px+1,py+1,cs-2,cs-2);
    mctx.fillStyle='rgba(255,255,255,0.2)'; mctx.fillRect(px+2,py+2,cs-4,2);
  }
}

function updateUI() {
  document.getElementById('score').textContent = score ?? 0;
  document.getElementById('level').textContent = level ?? 1;
  document.getElementById('lines').textContent = lines ?? 0;
  document.getElementById('highscore').textContent = highScore ?? 0;
  const linesEl = document.getElementById('lines-to-level');
  if (linesEl) linesEl.textContent = Math.max(0, (level ?? 1) * 10 - (lines ?? 0));
}

// ── Settings UI ───────────────────────────────────────────────────────────────
function applySettingsUI() {
  setToggle('toggle-vibration', settings.vibration);

  const sd = document.getElementById('slider-delay');
  sd.value = settings.repeatDelay;
  document.getElementById('val-delay').textContent = settings.repeatDelay+'ms';

  const ss = document.getElementById('slider-speed');
  ss.value = settings.repeatSpeed;
  document.getElementById('val-speed').textContent = settings.repeatSpeed+'ms';

  const sl = document.getElementById('slider-lock');
  sl.value = settings.lockDelay;
  document.getElementById('val-lock').textContent = settings.lockDelay+'ms';

  const sts = document.getElementById('slider-touch-sens');
  sts.value = settings.touchSensitivity;
  document.getElementById('val-touch-sens').textContent = settings.touchSensitivity+'px';

  setToggle('toggle-music', settings.musicOn);
  setToggle('toggle-music-start', settings.musicOn);
  const sm = document.getElementById('slider-music');
  if (sm) { sm.value = settings.musicVolume; document.getElementById('val-music').textContent = settings.musicVolume+'%'; }

  setToggle('toggle-viz', settings.edcMode);
  setToggle('toggle-viz-start', settings.edcMode);

  setToggle('toggle-buttons', settings.onscreenButtons);
  setToggle('toggle-buttons-start', settings.onscreenButtons);
  updateBtnBar();
}

function setToggle(id, val) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('on', val);
}

function addToggleListener(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', fn);
  el.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); fn(); }, {passive: false});
}

addToggleListener('toggle-vibration', () => {
  settings.vibration = !settings.vibration;
  setToggle('toggle-vibration', settings.vibration);
  // Fire a test buzz immediately so user feels it turn on
  if (settings.vibration) vib(60, 2, 1.0); // test buzz so user feels it turn on
  saveSettings();
});

// ── Music (dual-player crossfade engine) ──────────────────────────────────────
// Rule: softPlayer (Softly Falling Blocks) plays everywhere by default.
//       edcPlayer (Cyber Jurassic Tetris) plays while EDC mode is on
//       AND a game is running (including paused — switches back only on menus/game over).
//       This rule applies regardless of game mode — call Music.play() on any
//       state change and desiredPlayer() resolves the right track automatically.
// Switching players pauses the outgoing one so both tracks preserve their position.
const Music = (() => {
  const FADE_SECS = 2.5;
  const STEP_MS   = 50;

  function makePlayer(src) {
    const a = new Audio(src); a.preload = 'auto';
    const b = new Audio(src); b.preload = 'auto';
    const p = { a, b, active: a, next: b, fading: false };

    function crossfade() {
      if (p.fading) return;
      p.fading = true;
      const vol = p.active.volume; // fade relative to current playing volume
      p.next.currentTime = 0; p.next.volume = 0;
      p.next.play().catch(() => {});
      const steps = (FADE_SECS * 1000) / STEP_MS;
      let s = 0;
      const id = setInterval(() => {
        s++;
        const t = Math.min(s / steps, 1);
        p.active.volume = vol * (1 - t);
        p.next.volume   = vol * t;
        if (s >= steps) {
          clearInterval(id);
          p.active.pause(); p.active.currentTime = 0;
          [p.active, p.next] = [p.next, p.active];
          p.fading = false;
        }
      }, STEP_MS);
    }

    [a, b].forEach(track => {
      track.addEventListener('timeupdate', () => {
        if (track === p.active && !p.fading && track.duration) {
          if (track.currentTime >= track.duration - FADE_SECS) crossfade();
        }
      });
    });

    return p;
  }

  const softPlayer = makePlayer('Softly Falling Blocks.mp3');
  const edcPlayer  = makePlayer('Cyber Jurassic Tetris.mp3');
  let current = softPlayer;

  function targetVol() {
    if (!settings.musicOn) return 0;
    if (!gameRunning || paused) return 0.15;
    return settings.musicVolume / 100;
  }

  function desiredPlayer() {
    return (settings.edcMode && gameRunning) ? edcPlayer : softPlayer;
  }

  function activate(player) {
    if (player !== current) {
      current.active.pause();
      if (!current.next.paused) current.next.pause();
      current = player;
    }
    current.active.volume = targetVol();
    current.active.play().catch(() => {});
  }

  return {
    play()       { activate(desiredPlayer()); },
    pause()      { softPlayer.a.pause(); softPlayer.b.pause();
                   edcPlayer.a.pause();  edcPlayer.b.pause(); },
    setVolume(v) { current.active.volume = v;
                   if (!current.next.paused) current.next.volume = v; },
    // Unlock audio elements on first user gesture so later non-gesture play() calls work
    unlock()     { softPlayer.active.play().then(() => { if (!settings.musicOn) softPlayer.active.pause(); }).catch(() => {}); },
    // Resets EDC player to start for a new game; soft player keeps its position
    restart()    {
      edcPlayer.fading = false;
      edcPlayer.a.pause(); edcPlayer.b.pause();
      edcPlayer.a.currentTime = 0; edcPlayer.b.currentTime = 0;
      edcPlayer.active = edcPlayer.a; edcPlayer.next = edcPlayer.b;
    },
  };
})();

function applyMusicState() {
  if (settings.musicOn) Music.play();
  else Music.pause();
}

function toggleMusicSetting() {
  settings.musicOn = !settings.musicOn;
  setToggle('toggle-music', settings.musicOn);
  setToggle('toggle-music-start', settings.musicOn);
  applyMusicState();
  saveSettings();
}
addToggleListener('toggle-music', toggleMusicSetting);
addToggleListener('toggle-music-start', toggleMusicSetting);

document.getElementById('slider-music').addEventListener('input', e => {
  settings.musicVolume = parseInt(e.target.value);
  document.getElementById('val-music').textContent = settings.musicVolume + '%';
  if (settings.musicOn && gameRunning) Music.setVolume(paused ? 0.15 : settings.musicVolume / 100);
  saveSettings();
});

// ── Visualizer ────────────────────────────────────────────────────────────────
// xf/yf   = emitter position (fraction of screen)
// base    = centre angle of sweep (radians) — aimed inward from each edge
// amp     = half-amplitude of sweep (≈ π*0.45 keeps beams on screen)
// period  = ms for one full sweep cycle (lower = faster)
// phase   = time offset so lasers don't all reverse simultaneously
// fan     = half-angle spread across outermost beams
// beams   = number of beams spread evenly within ±fan
// 4 speed groups (period ms): A=7000, B=8500, C=10000, D=12000
const P = Math.PI;
const VIZ_LASERS = [
  // ── Left edge (aim right, base ≈ 0) ─────────────────────────────────────────
  { xf:0,    yf:0.18, base: 0.00,  amp:P*0.42, period: 7000, phase:0.00,      fan:0.20, beams:3, color:[0,245,255],  pulsePeriod: 400, pulsePhase:0.00 }, // A cyan   — fast pulse
  { xf:0,    yf:0.50, base: 0.10,  amp:P*0.44, period:10000, phase:P*0.55,    fan:0.18, beams:3, color:[130,0,255]   }, // C purple  — steady
  { xf:0,    yf:0.80, base:-0.10,  amp:P*0.43, period: 8500, phase:P*1.10,    fan:0.17, beams:3, color:[0,180,255],  pulsePeriod: 600, pulsePhase:1.20 }, // B sky    — pulse

  // ── Right edge (aim left, base ≈ π) ─────────────────────────────────────────
  { xf:1,    yf:0.18, base: P,     amp:P*0.42, period: 8500, phase:P*0.30,    fan:0.20, beams:3, color:[255,0,110],  pulsePeriod: 350, pulsePhase:2.10 }, // B pink   — fast pulse
  { xf:1,    yf:0.50, base: P,     amp:P*0.44, period:12000, phase:P*0.85,    fan:0.18, beams:3, color:[255,190,11]  }, // D yellow  — steady
  { xf:1,    yf:0.80, base: P,     amp:P*0.43, period: 7000, phase:P*1.60,    fan:0.17, beams:3, color:[255,80,0],   pulsePeriod: 500, pulsePhase:3.50 }, // A orange — pulse

  // ── Top edge (aim down, base ≈ π/2) ─────────────────────────────────────────
  { xf:0.20, yf:0,    base: P*0.5, amp:P*0.42, period:12000, phase:P*0.20,    fan:0.18, beams:3, color:[0,255,136]   }, // D green   — steady
  { xf:0.50, yf:0,    base: P*0.5, amp:P*0.44, period: 7000, phase:P*1.30,    fan:0.20, beams:3, color:[180,0,255],  pulsePeriod: 450, pulsePhase:0.80 }, // A violet — pulse
  { xf:0.80, yf:0,    base: P*0.5, amp:P*0.42, period: 8500, phase:P*0.70,    fan:0.18, beams:3, color:[0,220,255],  pulsePeriod: 380, pulsePhase:4.70 }, // B ice    — fast pulse

  // ── Bottom edge (aim up, base ≈ -π/2) ───────────────────────────────────────
  { xf:0.25, yf:1,    base:-P*0.5, amp:P*0.43, period:10000, phase:P*0.40,    fan:0.19, beams:3, color:[255,40,140], pulsePeriod: 420, pulsePhase:1.60 }, // C rose   — pulse
  { xf:0.50, yf:1,    base:-P*0.5, amp:P*0.45, period:12000, phase:P*1.05,    fan:0.22, beams:3, color:[255,220,0]   }, // D gold    — steady
  { xf:0.75, yf:1,    base:-P*0.5, amp:P*0.43, period: 7000, phase:P*1.75,    fan:0.19, beams:3, color:[0,255,200],  pulsePeriod: 550, pulsePhase:2.90 }, // A teal   — pulse

  // ── Corner accents ───────────────────────────────────────────────────────────
  { xf:0.08, yf:0.08, base: P*0.25,amp:P*0.40, period: 8500, phase:P*0.95,   fan:0.16, beams:3, color:[255,0,200],  pulsePeriod: 320, pulsePhase:0.40 }, // B magenta — fast pulse
  { xf:0.92, yf:0.92, base:-P*0.75,amp:P*0.40, period:10000, phase:P*1.45,   fan:0.16, beams:3, color:[100,255,0],  pulsePeriod: 480, pulsePhase:3.80 }, // C lime   — pulse
];

const vizCanvas = document.getElementById('viz-canvas');
const vizCtx    = vizCanvas.getContext('2d');

function resizeViz() {
  vizCanvas.width  = window.innerWidth;
  vizCanvas.height = window.innerHeight;
}

// Draw one laser beam: 3 concentric strokes (outer glow → core)
// alpha multiplied by pulse (1.0 = steady, 0–1 = pulsing laser)
function drawBeam(x1, y1, angle, len, r, g, b, alpha) {
  const x2 = x1 + Math.cos(angle) * len;
  const y2 = y1 + Math.sin(angle) * len;
  vizCtx.beginPath(); vizCtx.moveTo(x1, y1); vizCtx.lineTo(x2, y2);
  vizCtx.strokeStyle = `rgba(${r},${g},${b},${(alpha * 0.09).toFixed(3)})`;
  vizCtx.lineWidth = 64; vizCtx.stroke();
  vizCtx.beginPath(); vizCtx.moveTo(x1, y1); vizCtx.lineTo(x2, y2);
  vizCtx.strokeStyle = `rgba(${r},${g},${b},${(alpha * 0.20).toFixed(3)})`;
  vizCtx.lineWidth = 20; vizCtx.stroke();
  vizCtx.beginPath(); vizCtx.moveTo(x1, y1); vizCtx.lineTo(x2, y2);
  vizCtx.strokeStyle = `rgba(${r},${g},${b},${(alpha * 0.80).toFixed(3)})`;
  vizCtx.lineWidth = 6;  vizCtx.stroke();
}

// Strobe panels — large color washes that flood a whole quadrant of the screen
// xf/yf = center of wash, radius = fraction of screen diagonal
// period = ms per flash cycle, phase = time offset, threshold = 0–1 (higher = briefer flash)
const STROBES = [
  // corners — big slow washes
  { xf:0.00, yf:0.00, radiusF:0.75, period: 900, phase:0.00,       threshold:0.30, color:[255,0,160]   },
  { xf:1.00, yf:0.00, radiusF:0.75, period:1100, phase:Math.PI,     threshold:0.30, color:[0,200,255]   },
  { xf:0.00, yf:1.00, radiusF:0.75, period:1300, phase:2.00,        threshold:0.30, color:[0,255,120]   },
  { xf:1.00, yf:1.00, radiusF:0.75, period: 800, phase:3.50,        threshold:0.30, color:[255,160,0]   },
  // mid-edges — medium washes
  { xf:0.50, yf:0.00, radiusF:0.60, period: 700, phase:1.10,        threshold:0.35, color:[180,0,255]   },
  { xf:0.50, yf:1.00, radiusF:0.60, period:1000, phase:4.20,        threshold:0.35, color:[255,220,0]   },
  { xf:0.00, yf:0.50, radiusF:0.60, period: 850, phase:5.00,        threshold:0.35, color:[0,255,200]   },
  { xf:1.00, yf:0.50, radiusF:0.60, period: 950, phase:2.70,        threshold:0.35, color:[255,60,60]   },
  // centre — occasional full-screen pop
  { xf:0.50, yf:0.50, radiusF:1.10, period:2200, phase:1.60,        threshold:0.60, color:[255,255,255] },
];

function drawStrobe(cx, cy, radius, r, g, b, brightness) {
  // Two-stop gradient: dense colour near origin, fully transparent at radius
  // Extra large inner stop (0.5) keeps colour spread diffused, not a tight dot
  const grad = vizCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0,    `rgba(${r},${g},${b},${(brightness * 0.35).toFixed(3)})`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},${(brightness * 0.18).toFixed(3)})`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  vizCtx.fillStyle = grad;
  vizCtx.fill();
}

function updateViz(ts) {
  const w = vizCanvas.width, h = vizCanvas.height;

  if (!settings.edcMode || !gameRunning) {
    vizCtx.clearRect(0, 0, w, h);
    return;
  }

  const intensity = paused ? 0.35 : 1.0;
  const beamLen   = Math.hypot(w, h);

  vizCtx.clearRect(0, 0, w, h);
  vizCtx.save();
  vizCtx.globalCompositeOperation = 'lighter';
  vizCtx.lineCap = 'round';

  // ── Strobes first (behind lasers) ──
  STROBES.forEach(s => {
    const raw = Math.sin((ts / s.period) * Math.PI * 2 + s.phase);
    const brightness = Math.max(0, (raw - s.threshold) / (1 - s.threshold)) * intensity;
    if (brightness < 0.01) return;
    const [r, g, b] = s.color;
    const radius = beamLen * s.radiusF;
    drawStrobe(s.xf * w, s.yf * h, radius, r, g, b, brightness);
  });

  // ── Lasers (on top) ──
  VIZ_LASERS.forEach(l => {
    const x     = l.xf * w;
    const y     = l.yf * h;
    const angle = l.base + Math.sin((ts / l.period) * Math.PI * 2 + l.phase) * l.amp;
    const [r, g, b] = l.color;

    // Pulsing lasers: brightness rides a fast sine; steady lasers stay at 1.0
    const pulse = l.pulsePeriod
      ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((ts / l.pulsePeriod) * Math.PI * 2 + l.pulsePhase))
      : 1.0;
    const alpha = 0.55 * intensity * pulse;

    for (let bi = 0; bi < l.beams; bi++) {
      const t      = l.beams === 1 ? 0 : (bi / (l.beams - 1) - 0.5) * 2;
      const bAngle = angle + t * l.fan;
      drawBeam(x, y, bAngle, beamLen, r, g, b, alpha);
    }
  });

  vizCtx.restore();
}

function updateBtnBar() {
  const bar = document.getElementById('btn-bar');
  const show = settings.onscreenButtons && !!gameRunning && !paused;
  if (show) bar.classList.add('visible');
  else bar.classList.remove('visible');
  resize(); // recalculate board size to fit available space
}

function toggleButtonsSetting() {
  settings.onscreenButtons = !settings.onscreenButtons;
  setToggle('toggle-buttons', settings.onscreenButtons);
  setToggle('toggle-buttons-start', settings.onscreenButtons);
  updateBtnBar();
  saveSettings();
}
addToggleListener('toggle-buttons',       toggleButtonsSetting);
addToggleListener('toggle-buttons-start', toggleButtonsSetting);

function toggleVizSetting() {
  settings.edcMode = !settings.edcMode;
  setToggle('toggle-viz', settings.edcMode);
  setToggle('toggle-viz-start', settings.edcMode);
  if (!settings.edcMode) vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  if (settings.musicOn) Music.play();
  saveSettings();
}
addToggleListener('toggle-viz', toggleVizSetting);
addToggleListener('toggle-viz-start', toggleVizSetting);

document.getElementById('slider-delay').addEventListener('input', e => {
  settings.repeatDelay = parseInt(e.target.value);
  document.getElementById('val-delay').textContent = settings.repeatDelay+'ms';
  saveSettings();
});
document.getElementById('slider-speed').addEventListener('input', e => {
  settings.repeatSpeed = parseInt(e.target.value);
  document.getElementById('val-speed').textContent = settings.repeatSpeed+'ms';
  saveSettings();
});

document.getElementById('slider-lock').addEventListener('input', e => {
  settings.lockDelay = parseInt(e.target.value);
  document.getElementById('val-lock').textContent = settings.lockDelay+'ms';
  saveSettings();
});

document.getElementById('slider-touch-sens').addEventListener('input', e => {
  settings.touchSensitivity = parseInt(e.target.value);
  document.getElementById('val-touch-sens').textContent = settings.touchSensitivity+'px';
  saveSettings();
});

// ── Reset controls to default ─────────────────────────────────────────────────
function resetControls() {
  settings.repeatDelay = 200;
  settings.repeatSpeed = 80;
  settings.lockDelay = 500;
  settings.touchSensitivity = 30;
  applySettingsUI();
  saveSettings();
}
document.getElementById('reset-controls-btn').addEventListener('click', resetControls);

// ── Make range sliders respond to touch (body has touch-action:none) ──────────
document.querySelectorAll('input[type=range]').forEach(slider => {
  slider.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});
  slider.addEventListener('touchmove', e => {
    e.stopPropagation();
    const touch = e.touches[0];
    const rect = slider.getBoundingClientRect();
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const step = parseFloat(slider.step) || 1;
    const ratio = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const stepped = Math.round((min + ratio * (max - min)) / step) * step;
    if (parseFloat(slider.value) !== stepped) {
      slider.value = stepped;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, {passive: true});
  slider.addEventListener('touchend', e => e.stopPropagation(), {passive: true});
});

// ── Controls popup ────────────────────────────────────────────────────────────
const controlsPopup = document.getElementById('controls-popup');

function openControlsPopup() {
  controlsPopup.classList.add('visible');
}
function closeControlsPopup() {
  controlsPopup.classList.remove('visible');
}

document.getElementById('controls-info-btn').addEventListener('click', e => {
  e.stopPropagation();
  openControlsPopup();
});

// Close on any click or touch anywhere (the whole overlay is clickable)
controlsPopup.addEventListener('click', closeControlsPopup);
controlsPopup.addEventListener('touchend', closeControlsPopup);

// Close on any keypress
document.addEventListener('keydown', e => {
  if (controlsPopup.classList.contains('visible')) {
    closeControlsPopup();
    e.stopPropagation();
    return;
  }
}, true); // capture phase so it fires before game handlers

// ── Keyboard with DAS (Delayed Auto Shift) ────────────────────────────────────
// DAS: tap = single move. Hold = wait repeatDelay ms, then repeat every repeatSpeed ms.
const dasTimers = {}; // { key: { timeout, interval } }

function dasStart(key, fn) {
  if (dasTimers[key]) return; // already held
  fn(); // immediate first move on keydown
  dasTimers[key] = {};
  dasTimers[key].timeout = setTimeout(() => {
    dasTimers[key].interval = setInterval(() => {
      if (gameRunning && !paused) fn();
    }, settings.repeatSpeed);
  }, settings.repeatDelay);
}

function dasStop(key) {
  if (!dasTimers[key]) return;
  clearTimeout(dasTimers[key].timeout);
  clearInterval(dasTimers[key].interval);
  delete dasTimers[key];
}

document.addEventListener('keydown', e => {
  if (!gameRunning || paused) {
    if (e.key === 'Escape') togglePause();
    return;
  }
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      dasStart('ArrowLeft', () => { moveLeft(); });
      break;
    case 'ArrowRight':
      e.preventDefault();
      dasStart('ArrowRight', () => { moveRight(); });
      break;
    case 'ArrowDown':
      e.preventDefault();
      dasStart('ArrowDown', () => { moveDown(); score++; updateUI(); dropCounter=0; });
      break;
    case 'ArrowUp': case 'x':
      e.preventDefault();
      if (!dasTimers[e.key]) { dasTimers[e.key] = true; tryRotate(); vibRotate(); }
      break;
    case 'z': case 'Z':
      e.preventDefault();
      if (!dasTimers['z']) { dasTimers['z'] = true; tryRotateLeft(); vibRotate(); }
      break;
    case ' ':
      e.preventDefault();
      if (!dasTimers[' ']) { dasTimers[' '] = true; hardDrop(); vibDrop(); }
      break;
    case 'c': case 'Shift':
      e.preventDefault();
      if (!dasTimers['hold']) { dasTimers['hold'] = true; hold(); }
      break;
    case 'Escape':
      togglePause();
      break;
  }
});

document.addEventListener('keyup', e => {
  switch (e.key) {
    case 'ArrowLeft':  dasStop('ArrowLeft');  break;
    case 'ArrowRight': dasStop('ArrowRight'); break;
    case 'ArrowDown':  dasStop('ArrowDown');  break;
    case 'ArrowUp': case 'x': delete dasTimers[e.key]; break;
    case 'z': case 'Z': delete dasTimers['z']; break;
    case ' ':          delete dasTimers[' '];  break;
    case 'c': case 'Shift': delete dasTimers['hold']; break;
  }
});

// ── Touch Controls ────────────────────────────────────────────────────────────
let touchStartX, touchStartY, touchStartTime;
let touchLastX, touchLastY;
let touchAccumX = 0;   // accumulated px for sensitivity-based column moves
let touchMoved;
let touchDownLocked;

// Soft drop state
let softDropActive = false;
let softDropLastY = 0;
let softDropInterval = null;
const SOFT_DROP_CELL_PX = 18;

function stopSoftDrop() {
  if (softDropInterval) { clearInterval(softDropInterval); softDropInterval = null; }
  softDropActive = false;
}
function startSoftDrop() {
  if (softDropActive) return;
  softDropActive = true;
  softDropInterval = setInterval(() => {
    if (!gameRunning || paused) { stopSoftDrop(); return; }
    moveDown(); score++; updateUI(); dropCounter = 0;
  }, 50);
}
function rotateByScreenSide(clientX) {
  if (clientX < window.innerWidth / 2) tryRotateLeft(); else tryRotate();
}
function isInEl(x, y, el) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// Declare holdBox and pauseBtnBox here so touch handlers can reference them
const holdBox     = holdCvs.closest('.panel-box') || holdCvs;
const pauseBtnBox = document.getElementById('pause-btn-box');

function isUIEl(x, y) {
  // Hold box, pause button, and any overlay (start screen, pause screen, gameover screen)
  if (isInEl(x, y, holdBox) || isInEl(x, y, pauseBtnBox)) return true;
  // Any visible overlay — let native click/touch pass through
  const overlays = document.querySelectorAll('.overlay:not(.hidden)');
  for (const o of overlays) { if (isInEl(x, y, o)) return true; }
  return false;
}

function onTouchStart(e) {
  const t = e.touches[0];
  if (isUIEl(t.clientX, t.clientY)) return; // let hold/pause handle it
  e.preventDefault();
  _ensureVibAudio(); // unlock AudioContext on any touch — required for iOS haptics
  touchStartX    = t.clientX;
  touchStartY    = t.clientY;
  touchLastX     = t.clientX;
  touchLastY     = t.clientY;
  softDropLastY  = t.clientY;
  touchStartTime = Date.now();
  touchAccumX    = 0;
  touchMoved     = false;
  touchDownLocked = false;
  holdTouchActive = false; // touch started on game board, not hold box
  stopSoftDrop();
}

function onTouchMove(e) {
  const t = e.touches[0];
  if (isUIEl(t.clientX, t.clientY)) return;
  e.preventDefault();
  if (!gameRunning || paused || touchDownLocked) return;

  const totalDy    = t.clientY - touchStartY;
  const totalDyAbs = Math.abs(totalDy);
  const totalDx    = Math.abs(t.clientX - touchStartX);
  const dt         = Date.now() - touchStartTime;
  const sens       = settings.touchSensitivity || 30;

  // Hard drop — very fast flick: >100px down, very vertical, within 180ms
  if (totalDy > 100 && totalDyAbs > totalDx * 5 && dt < 180 && !softDropActive) {
    hardDrop();
    vibDrop();
    touchDownLocked = true; stopSoftDrop(); touchAccumX = 0; return;
  }

  // Soft drop — any sustained downward drag (not a fast flick)
  if (totalDy > 18 && totalDyAbs > totalDx * 0.8 && !softDropActive && dt >= 80) {
    startSoftDrop(); touchMoved = true;
  }
  if (softDropActive) {
    const down = t.clientY - softDropLastY;
    if (down >= SOFT_DROP_CELL_PX) {
      const ticks = Math.floor(down / SOFT_DROP_CELL_PX);
      for (let i = 0; i < ticks; i++) {
        if (!gameRunning || paused) break;
        moveDown(); score++; updateUI(); dropCounter = 0;
      }
      softDropLastY += ticks * SOFT_DROP_CELL_PX;
    }
    touchAccumX = 0; // no horizontal movement during soft drop
    touchLastX = t.clientX; touchLastY = t.clientY; return;
  }

  // Horizontal tracking — accumulate pixels, fire move per `sens` px
  const dxFromLast = t.clientX - touchLastX;
  if (Math.abs(t.clientX - touchStartX) > 8 || touchMoved) {
    touchMoved = true;
    touchAccumX += dxFromLast;
    if (Math.abs(touchAccumX) >= sens) {
      const steps = Math.floor(Math.abs(touchAccumX) / sens);
      const fn = touchAccumX > 0 ? moveRight : moveLeft;
      let moved = 0;
      for (let i = 0; i < steps; i++) {
        const before = current.x;
        fn();
        if (current.x !== before) moved++;
      }
      if (moved > 0) vibMove();
      touchAccumX -= steps * sens * Math.sign(touchAccumX);
    }
  }
  touchLastX = t.clientX; touchLastY = t.clientY;
}

function onTouchEnd(e) {
  const t = e.changedTouches[0];
  if (isUIEl(t.clientX, t.clientY)) return;
  e.preventDefault();
  stopSoftDrop();
  if (!gameRunning || paused || touchDownLocked) return;
  const dx = t.clientX - touchStartX, dy = t.clientY - touchStartY;
  const dt = Date.now() - touchStartTime;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (!touchMoved && ax < 18 && ay < 18 && dt < 300) {
    rotateByScreenSide(t.clientX);
    vibRotate();
    return;
  }
  if (ay > ax && dy < -40) { hold(); return; }
}

// ── Attach to document so the ENTIRE screen is the touch surface ──────────────
document.addEventListener('touchstart', onTouchStart, {passive: false});
document.addEventListener('touchmove',  onTouchMove,  {passive: false});
document.addEventListener('touchend',   onTouchEnd,   {passive: false});

// Hold box tap — only trigger hold when the touch *started* on the hold box (not a slide-through)
let holdTouchActive = false;
holdBox.addEventListener('touchstart', e => { e.stopPropagation(); holdTouchActive = true; }, {passive: false});
holdBox.addEventListener('touchend', e => {
  e.preventDefault(); e.stopPropagation();
  if (gameRunning && !paused && holdTouchActive) hold();
  holdTouchActive = false;
}, {passive: false});
holdCvs.style.cursor = 'pointer';

// Pause box tap
pauseBtnBox.addEventListener('touchstart', e => { e.stopPropagation(); }, {passive: false});
pauseBtnBox.addEventListener('touchend', e => {
  e.preventDefault(); e.stopPropagation();
  togglePause();
}, {passive: false});

// Pause/gameover/start overlays — stop all touches from reaching document game handler
document.querySelectorAll('.overlay').forEach(el => {
  el.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});
  el.addEventListener('touchmove',  e => e.stopPropagation(), {passive: true});
  el.addEventListener('touchend',   e => e.stopPropagation(), {passive: true});
});

// ── Pause ─────────────────────────────────────────────────────────────────────
function togglePause() {
  if (!gameRunning) return;
  paused = !paused;
  document.getElementById('pause-screen').classList.toggle('hidden', !paused);
  if (settings.musicOn) Music.play();
  if (!paused) lastTime = performance.now();
  updateBtnBar();
}
document.getElementById('pause-btn-box').addEventListener('click', togglePause);
document.getElementById('resume-btn').addEventListener('click', togglePause);
document.getElementById('pause-restart-btn').addEventListener('click', () => {
  clearSnapshot();
  document.getElementById('pause-screen').classList.add('hidden');
  const raw = parseInt(document.getElementById('start-level-input').value) || 1;
  const startLevel = Math.max(1, Math.min(20, raw));
  initGame(startLevel);
});
document.getElementById('quit-btn').addEventListener('click', () => {
  document.getElementById('pause-screen').classList.add('hidden');
  document.getElementById('quit-confirm-screen').classList.remove('hidden');
});
document.getElementById('quit-yes-btn').addEventListener('click', () => {
  gameRunning = false;
  paused = false;
  cancelAnimationFrame(animId);
  if (settings.musicOn) Music.play();
  document.getElementById('quit-confirm-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  updateBtnBar();
});
document.getElementById('quit-no-btn').addEventListener('click', () => {
  document.getElementById('quit-confirm-screen').classList.add('hidden');
  document.getElementById('pause-screen').classList.remove('hidden');
});

// Resume saved game
document.getElementById('resume-saved-btn').addEventListener('click', () => {
  document.getElementById('start-screen').classList.add('hidden');
  resumeGame();
});

// Starting a new game clears any saved snapshot
document.getElementById('start-btn').addEventListener('click', () => {
  clearSnapshot();
  const raw = parseInt(document.getElementById('start-level-input').value) || 1;
  const startLevel = Math.max(1, Math.min(20, raw));
  document.getElementById('start-screen').classList.add('hidden');
  initGame(startLevel);
});

document.getElementById('restart-btn').addEventListener('click', () => {
  clearSnapshot();
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  updateResumeBtn();
});

// Tag submit
document.getElementById('tag-submit-btn').addEventListener('click', () => {
  const tag = document.getElementById('tag-input').value.trim().toUpperCase() || '???';
  insertScore(tag, score);
  document.getElementById('tag-entry').classList.add('hidden');
  document.getElementById('tag-entry').style.display = 'none';
});

// Tag input: force uppercase, submit on Enter
document.getElementById('tag-input').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
});
document.getElementById('tag-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('tag-submit-btn').click();
});

// Skip tag entry
document.getElementById('tag-skip-btn').addEventListener('click', () => {
  document.getElementById('tag-entry').classList.add('hidden');
  document.getElementById('tag-entry').style.display = 'none';
});

// Leaderboard from game over screen
document.getElementById('go-leaderboard-btn').addEventListener('click', openLeaderboard);

// Leaderboard from start screen
document.getElementById('start-leaderboard-btn').addEventListener('click', openLeaderboard);

// Leaderboard close — go back to start screen
document.getElementById('leaderboard-close-btn').addEventListener('click', () => {
  document.getElementById('leaderboard-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadSettings();
highScore = getBestScore();
updateUI();
updateResumeBtn(); // show resume button if a saved game exists

// Browsers block autoplay until a user gesture. Unlock audio on first interaction
// so that later Music.play() calls work even from non-gesture contexts (e.g. keyboard).
// If music is off, do nothing — calling play() even briefly takes over the iOS audio
// session and interrupts any music the user is already listening to.
function onFirstGesture() {
  if (settings.musicOn) Music.play();
}
document.addEventListener('click',      onFirstGesture, { once: true });
document.addEventListener('touchstart', onFirstGesture, { once: true });

// Unlock WebAudio (needed for iOS haptics) on every touch, including taps on overlays.
// Must use capture phase so it fires BEFORE overlay stopPropagation() blocks bubbling.
document.addEventListener('touchstart', _ensureVibAudio, { passive: true, capture: true });
window.addEventListener('resize', resize);
resize();

// ── On-screen game control buttons ────────────────────────────────────────────
function setupGameCtrlBtn(id, onDown, onUp) {
  const btn = document.getElementById(id);
  if (!btn) return;
  // Block touches from leaking to the game board touch handlers
  btn.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  btn.addEventListener('touchmove',  e => e.stopPropagation(), { passive: true });
  btn.addEventListener('touchend',   e => e.stopPropagation(), { passive: true });
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    if (gameRunning && !paused) { _ensureVibAudio(); onDown(); }
  });
  if (onUp) {
    btn.addEventListener('pointerup',     () => onUp());
    btn.addEventListener('pointercancel', () => onUp());
  }
}

setupGameCtrlBtn('gcbtn-left',
  () => dasStart('btn-left',  () => { moveLeft();  vibMove(); }),
  () => dasStop('btn-left')
);
setupGameCtrlBtn('gcbtn-right',
  () => dasStart('btn-right', () => { moveRight(); vibMove(); }),
  () => dasStop('btn-right')
);
setupGameCtrlBtn('gcbtn-down',
  () => startSoftDrop(),
  () => stopSoftDrop()
);
setupGameCtrlBtn('gcbtn-rotl',  () => { tryRotateLeft(); vibRotate(); });
setupGameCtrlBtn('gcbtn-rotr',  () => { tryRotate();     vibRotate(); });
setupGameCtrlBtn('gcbtn-hold',  () => { hold(); });
setupGameCtrlBtn('gcbtn-drop',  () => { hardDrop(); vibDrop(); });

// Auto-pause and save snapshot when app goes to background
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (gameRunning && !paused) togglePause();
    Music.pause(); // always stop music when screen off / app backgrounded
    saveSnapshot();
  } else {
    if (settings.musicOn) Music.play(); // restore when returning to app
  }
});
// Also save on page close/navigation
window.addEventListener('pagehide', saveSnapshot);
window.addEventListener('beforeunload', saveSnapshot);

// ── Service Worker — caches this page for offline/airplane mode play ──────────
if ('serviceWorker' in navigator) {
  // Inline the SW as a blob so no separate sw.js file is needed
  const swCode = `
const CACHE = 'tetris-v1';
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap',
  'https://fonts.gstatic.com/s/pressstart2p/v15/ZLfdm8T8MB6-A_A4-6oqNIFGlFVCFIAZAbPRZp_eN_0.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      // Cache the page itself
      return cache.add(self.location.href.replace(/\\/sw-inline.js.*$/, ''))
        .catch(() => {})
        .then(() => cache.addAll(FONT_URLS).catch(() => {}));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache font files and the page itself for future offline use
        if (e.request.url.includes('fonts.g') || e.request.url.includes('.html') || e.request.url.endsWith('/')) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => cached || new Response('', {status: 408}));
    })
  );
});
`;
  const blob = new Blob([swCode], {type: 'application/javascript'});
  const swUrl = URL.createObjectURL(blob);
  navigator.serviceWorker.register(swUrl, {scope: './'})
    .catch(() => {}); // silently fail if SW registration fails (e.g. file://)
}
