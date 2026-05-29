/* =========================================================
   Match The Color · Lógica del frontend (JS vanilla)
   - Modo individual (solo): toda la lógica corre en el navegador.
   - Modo multijugador: el servidor (Socket.IO) es la fuente de verdad.
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. Constantes y utilidades
   --------------------------------------------------------- */
const TOTAL_ROUNDS = 5;
const MEMORIZE_MS = 3000;

// Atajo para document.getElementById
const $ = (id) => document.getElementById(id);

// Rangos de generación (deben coincidir con el servidor): evitan colores
// casi negros/grises donde el tono no se percibe.
const GEN_SAT_MIN = 25;
const GEN_VAL_MIN = 30;

/** Genera un color HSB aleatorio (igual que en el servidor). */
function randomColor() {
  const randRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  return {
    h: Math.floor(Math.random() * 360),  // 0-359
    s: randRange(GEN_SAT_MIN, 100),      // 25-100
    v: randRange(GEN_VAL_MIN, 100),      // 30-100
  };
}

/** Convierte HSB/HSV a RGB (0-255) para pintarlo en CSS. */
function hsvToRgb({ h, s, v }) {
  const S = s / 100, V = v / 100;
  const C = V * S;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = V - C;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = C; g1 = X; }
  else if (h < 120) { r1 = X; g1 = C; }
  else if (h < 180) { g1 = C; b1 = X; }
  else if (h < 240) { g1 = X; b1 = C; }
  else if (h < 300) { r1 = X; b1 = C; }
  else { r1 = C; b1 = X; }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** Representación CSS (rgb) de un color HSB. */
function colorToString(c) {
  const { r, g, b } = hsvToRgb(c);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Texto HSB legible (solo se muestra al revelar el resultado). */
function colorToHsbString(c) {
  return `hsb(${c.h}, ${c.s}%, ${c.v}%)`;
}

/**
 * Puntuación por proximidad en HSB (misma fórmula que el servidor).
 * El HUE es circular (distancia máxima 180º). Se usa SOLO en modo individual.
 */
function scoreRound(original, guess) {
  const rawHue = Math.abs(original.h - guess.h);
  const errHue = Math.min(rawHue, 360 - rawHue) / 180;
  const errSat = Math.abs(original.s - guess.s) / 100;
  const errBri = Math.abs(original.v - guess.v) / 100;
  const errNorm = (errHue + errSat + errBri) / 3;
  const score = Math.max(0, 10 * (1 - errNorm));
  return Math.round(score * 100) / 100;
}

/** Color de avatar determinista a partir de un id/nombre. */
function avatarColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/** Muestra una pantalla y oculta las demás. */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ---------------------------------------------------------
   1.b Sonidos (Web Audio API, sin archivos externos)
   --------------------------------------------------------- */
const Sound = {
  ctx: null,
  enabled: localStorage.getItem('mtc-sound') !== 'off',

  /** Crea el AudioContext la primera vez (tras interacción del usuario). */
  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  /** Reproduce un tono simple. freq en Hz, dur en segundos. */
  _tone(freq, dur, type = 'sine', gain = 0.2) {
    if (!this.enabled) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    vol.gain.setValueAtTime(gain, ctx.currentTime);
    // Envolvente de caída para un sonido más agradable.
    vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(vol).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  },

  /** Secuencia de notas (melodías cortas). notes: [{f, d}] */
  _sequence(notes) {
    if (!this.enabled) return;
    let t = 0;
    notes.forEach((n) => {
      setTimeout(() => this._tone(n.f, n.d, n.type || 'sine', n.g || 0.2), t * 1000);
      t += n.d;
    });
  },

  roundStart() { this._tone(660, 0.18, 'triangle'); },
  check()      { this._tone(880, 0.12, 'square', 0.15); },
  gameEnd()    { this._sequence([{ f: 523, d: 0.15 }, { f: 659, d: 0.15 }, { f: 784, d: 0.15 }, { f: 1047, d: 0.3 }]); },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('mtc-sound', this.enabled ? 'on' : 'off');
    if (this.enabled) this.check(); // pequeño feedback al activar
    return this.enabled;
  },
};

/* ---------------------------------------------------------
   2. Estado global de la aplicación
   --------------------------------------------------------- */
const state = {
  mode: null,           // 'solo' | 'multi'
  // --- común ---
  round: 0,             // ronda actual (1..5)
  totalScore: 0,
  roundScores: [],      // puntuaciones obtenidas
  originalColor: null,  // color objetivo de la ronda actual
  phase: 'idle',        // 'memorize' | 'guess' | 'wait' | 'idle'
  // --- solo ---
  countdownTimer: null,
  memorizeTimer: null,
  // --- multi ---
  socket: null,
  roomCode: null,
  playerId: null,
  players: [],
  hostId: null,
};

/* ---------------------------------------------------------
   3. Referencias al DOM de sliders / color
   --------------------------------------------------------- */
const sliders = {
  h: $('slider-h'), s: $('slider-s'), v: $('slider-v'),
};
const vals = {
  h: $('val-h'), s: $('val-s'), v: $('val-v'),
};
const colorArea = $('color-area');
const slidersBox = $('sliders');
const btnCheck = $('btn-check');

/** Lee el color HSB actual de los sliders. */
function readSliders() {
  return {
    h: parseInt(sliders.h.value, 10),
    s: parseInt(sliders.s.value, 10),
    v: parseInt(sliders.v.value, 10),
  };
}

/** Pinta el área grande con un color (usando la variable CSS --swatch). */
function paintArea(color) {
  colorArea.style.setProperty('--swatch', colorToString(color));
}

/** Actualiza etiquetas numéricas y vista previa en tiempo real. */
function updateSliderUI() {
  const c = readSliders();
  vals.h.textContent = c.h;
  vals.s.textContent = c.s;
  vals.v.textContent = c.v;
  // En la fase de adivinar, el área grande muestra la vista previa.
  if (state.phase === 'guess') paintArea(c);
}

// Cada slider actualiza la vista previa en tiempo real.
Object.values(sliders).forEach((s) => s.addEventListener('input', updateSliderUI));

/* ---------------------------------------------------------
   4. Fases visuales de una ronda (compartidas solo/multi)
   --------------------------------------------------------- */

/** Prepara la UI de la pantalla de juego para una ronda nueva. */
function setupRoundUI(round) {
  state.round = round;
  $('round-indicator').textContent = `Ronda ${round} / ${TOTAL_ROUNDS}`;
  $('round-score').textContent = '—';
  $('wait-others').classList.add('hidden');
}

/**
 * Fase de memorización: muestra SOLO el color (sin su valor) durante 3 s
 * con una cuenta atrás visual. Devuelve una promesa al terminar.
 */
function runMemorizePhase(color, memorizeMs) {
  state.phase = 'memorize';
  state.originalColor = color;
  Sound.roundStart();

  $('phase-indicator').textContent = '👀 Memoriza el color';
  slidersBox.classList.add('hidden');
  btnCheck.disabled = true;

  // Solo mostramos el color, SIN su valor numérico, para que el reto sea
  // puramente visual y no se pueda memorizar el texto.
  paintArea(color);
  $('ref-color-text').style.display = 'none';
  $('ref-color-text').textContent = '';

  // Cuenta atrás 3 → 2 → 1
  let remaining = Math.ceil(memorizeMs / 1000);
  const cd = $('countdown');
  cd.textContent = remaining;

  clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    remaining -= 1;
    cd.textContent = remaining > 0 ? remaining : '';
    if (remaining <= 0) clearInterval(state.countdownTimer);
  }, 1000);
}

/** Fase de adivinar: oculta la referencia y muestra los sliders. */
function runGuessPhase() {
  state.phase = 'guess';
  clearInterval(state.countdownTimer);

  $('countdown').textContent = '';
  $('ref-color-text').style.display = 'none';
  $('phase-indicator').textContent = '🎚️ Reproduce el color';

  // Reiniciamos los sliders a un punto neutro para cada ronda.
  sliders.h.value = 180; sliders.s.value = 50; sliders.v.value = 50;
  updateSliderUI();
  paintArea(readSliders());

  slidersBox.classList.remove('hidden');
  btnCheck.disabled = false;
  btnCheck.textContent = 'Comprobar';
}

/* ---------------------------------------------------------
   5. Panel de puntuación
   --------------------------------------------------------- */
function updateScorePanel() {
  $('total-score').textContent = state.totalScore.toFixed(2);
  const history = $('rounds-history');
  history.innerHTML = '';
  state.roundScores.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="muted">Ronda ${i + 1}</span><strong>${s.toFixed(2)}</strong>`;
    history.appendChild(li);
  });
}

/* =========================================================
   6. MODO INDIVIDUAL (solo)
   ========================================================= */
function startSoloGame() {
  state.mode = 'solo';
  state.round = 0;
  state.totalScore = 0;
  state.roundScores = [];
  $('multi-scoreboard-wrap').classList.add('hidden');
  updateScorePanel();
  showScreen('screen-game');
  nextSoloRound();
}

function nextSoloRound() {
  setupRoundUI(state.round + 1);
  const color = randomColor();
  runMemorizePhase(color, MEMORIZE_MS);
  clearTimeout(state.memorizeTimer);
  state.memorizeTimer = setTimeout(runGuessPhase, MEMORIZE_MS);
}

function checkSolo() {
  if (state.phase !== 'guess') return;
  Sound.check();
  const guess = readSliders();
  const score = scoreRound(state.originalColor, guess);

  state.roundScores.push(score);
  state.totalScore += score;
  state.phase = 'wait';

  // Mostrar puntuación de la ronda y el color correcto un instante.
  $('round-score').textContent = score.toFixed(2);
  updateScorePanel();
  revealSoloAnswer(score);
}

function revealSoloAnswer(score) {
  btnCheck.disabled = true;
  $('phase-indicator').textContent = `✅ +${score.toFixed(2)} puntos`;
  // Mostramos el color objetivo de nuevo para comparar (ya con su valor HSB,
  // pues la ronda ha terminado y conocerlo ayuda a calibrar).
  paintArea(state.originalColor);
  $('ref-color-text').style.display = '';
  $('ref-color-text').textContent = `Objetivo: ${colorToHsbString(state.originalColor)}`;

  setTimeout(() => {
    if (state.round >= TOTAL_ROUNDS) showSoloResults();
    else nextSoloRound();
  }, 1800);
}

function showSoloResults() {
  Sound.gameEnd();
  showScreen('screen-results');
  const max = TOTAL_ROUNDS * 10;
  const rows = state.roundScores
    .map((s, i) => `<li><span>Ronda ${i + 1}</span><strong>${s.toFixed(2)}</strong></li>`)
    .join('');
  $('results-content').innerHTML = `
    <div class="final-score-big">${state.totalScore.toFixed(2)} / ${max}</div>
    <p class="muted">Tu puntuación final tras ${TOTAL_ROUNDS} rondas.</p>
    <ul class="leaderboard">${rows}</ul>
  `;
}

/* =========================================================
   7. MODO MULTIJUGADOR (Socket.IO)
   ========================================================= */

/** Conecta al backend si aún no lo está. */
function ensureSocket() {
  if (state.socket && state.socket.connected) return state.socket;

  const url = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_URL) || '';
  // io() está disponible gracias al script del CDN en index.html.
  state.socket = io(url, { transports: ['websocket', 'polling'] });

  const badge = $('connection-badge');
  state.socket.on('connect', () => {
    state.playerId = state.socket.id;
    badge.textContent = '● online';
    badge.className = 'badge badge-on';
  });
  state.socket.on('disconnect', () => {
    badge.textContent = '● offline';
    badge.className = 'badge badge-off';
  });

  registerSocketEvents(state.socket);
  return state.socket;
}

/** Registra los manejadores de eventos del servidor. */
function registerSocketEvents(socket) {
  // Estado de la sala actualizado (jugadores, anfitrión, etc.).
  socket.on('room_update', (data) => {
    state.roomCode = data.code;
    state.players = data.players;
    state.hostId = data.hostId;
    renderRoomPlayers(data);
    renderMultiScoreboard(data.players);
  });

  // Comienza una ronda sincronizada: todos reciben el mismo color.
  socket.on('round_start', (data) => {
    showScreen('screen-game');
    $('multi-scoreboard-wrap').classList.remove('hidden');
    closeModal();
    setupRoundUI(data.round);
    runMemorizePhase(data.color, data.memorizeMs || MEMORIZE_MS);
    // Tras la memorización, el cliente pasa a la fase de adivinar.
    clearTimeout(state.memorizeTimer);
    state.memorizeTimer = setTimeout(runGuessPhase, data.memorizeMs || MEMORIZE_MS);
  });

  // Alguien ha comprobado (no revela su puntuación todavía).
  socket.on('player_checked', (data) => {
    $('wait-others').classList.remove('hidden');
    $('wait-others').textContent =
      `⏳ ${data.checkedCount}/${data.totalPlayers} jugadores han comprobado…`;
    markPlayerChecked(data.playerId);
  });

  // Fin de ronda: el servidor revela el color y las puntuaciones.
  socket.on('round_end', (data) => {
    state.phase = 'wait';
    // Actualizar nuestros propios acumulados a partir de los resultados.
    const me = data.results.find((r) => r.playerId === state.playerId);
    if (me) {
      $('round-score').textContent = me.roundScore.toFixed(2);
      state.totalScore = me.totalScore;
      state.roundScores.push(me.roundScore);
      updateScorePanel();
    }
    showRoundSummary(data);
  });

  // Fin de la partida: clasificación final.
  socket.on('game_end', (data) => {
    closeModal();
    showMultiResults(data.leaderboard);
  });

  // Un jugador salió de la sala.
  socket.on('player_left', () => {
    // room_update llegará a continuación con la lista actualizada.
  });
}

/* ----- Acciones de sala ----- */
function createRoom() {
  const name = $('input-name').value.trim();
  ensureSocket().emit('create_room', { name }, (res) => {
    if (res && res.ok) {
      enterRoom(res.code);
    } else {
      showEntryError((res && res.error) || 'No se pudo crear la sala.');
    }
  });
}

function joinRoom() {
  const name = $('input-name').value.trim();
  const code = $('input-code').value.trim().toUpperCase();
  if (code.length !== 6) {
    showEntryError('El código debe tener 6 caracteres.');
    return;
  }
  ensureSocket().emit('join_room', { code, name }, (res) => {
    if (res && res.ok) {
      enterRoom(res.code);
    } else {
      showEntryError((res && res.error) || 'No se pudo unir a la sala.');
    }
  });
}

function enterRoom(code) {
  state.mode = 'multi';
  state.roomCode = code;
  state.round = 0;
  state.totalScore = 0;
  state.roundScores = [];
  $('room-code-display').textContent = code;
  // Prerellenamos el campo de renombrado con el nombre actual del jugador.
  $('input-rename').value = $('input-name').value.trim();
  showScreen('screen-room');
}

/** Cambia el nombre del jugador (se sincroniza con toda la sala). */
function renamePlayer() {
  const name = $('input-rename').value.trim();
  if (!name) return;
  ensureSocket().emit('rename_player', { name }, (res) => {
    if (res && res.ok) {
      $('input-name').value = res.name; // mantener coherencia local
    } else if (res) {
      alert(res.error);
    }
  });
}

function startMultiGame() {
  state.roundScores = [];
  state.totalScore = 0;
  ensureSocket().emit('start_game', {}, (res) => {
    if (res && !res.ok) alert(res.error);
  });
}

function checkMulti() {
  if (state.phase !== 'guess') return;
  Sound.check();
  const guess = readSliders();
  btnCheck.disabled = true;
  state.phase = 'wait';
  ensureSocket().emit('submit_check', { guess }, (res) => {
    if (res && res.ok) {
      $('round-score').textContent = res.score.toFixed(2);
      $('phase-indicator').textContent = `✅ +${res.score.toFixed(2)} puntos`;
      $('wait-others').classList.remove('hidden');
    }
  });
}

function leaveRoom() {
  if (state.socket) state.socket.emit('leave_room');
  state.mode = null;
  state.roomCode = null;
  showScreen('screen-menu');
}

function restartMulti() {
  ensureSocket().emit('restart_game', {}, (res) => {
    if (res && res.ok) {
      state.round = 0;
      state.totalScore = 0;
      state.roundScores = [];
      showScreen('screen-room');
    } else if (res) {
      alert(res.error);
    }
  });
}

/* ----- Render de jugadores / marcador (multi) ----- */
function renderRoomPlayers(data) {
  const list = $('room-players');
  list.innerHTML = '';
  data.players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="pl-left">
        <span class="player-avatar" style="background:${avatarColor(p.id)}">${p.name.charAt(0).toUpperCase()}</span>
        <span>${escapeHtml(p.name)}</span>
        ${p.isHost ? '<span class="host-tag">Anfitrión</span>' : ''}
      </span>`;
    list.appendChild(li);
  });

  // Botón de iniciar: solo activo para el anfitrión con jugadores suficientes.
  const isHost = state.playerId === data.hostId;
  const startBtn = $('btn-start-game');
  const enough = data.players.length >= (data.minPlayers || 2);
  startBtn.disabled = !(isHost && enough);
  if (!isHost) {
    $('room-hint').textContent = 'Esperando a que el anfitrión inicie la partida…';
  } else if (!enough) {
    $('room-hint').textContent = `Necesitas al menos ${data.minPlayers || 2} jugadores para empezar.`;
  } else {
    $('room-hint').textContent = '¡Listo! Pulsa "Iniciar partida" cuando todos estén dentro.';
  }
}

function renderMultiScoreboard(players) {
  const wrap = $('multi-scoreboard');
  if (!wrap) return;
  wrap.innerHTML = '';
  players
    .slice()
    .sort((a, b) => b.totalScore - a.totalScore)
    .forEach((p) => {
      const li = document.createElement('li');
      li.dataset.playerId = p.id;
      li.innerHTML = `
        <span class="pl-left">
          <span class="player-avatar" style="background:${avatarColor(p.id)}">${p.name.charAt(0).toUpperCase()}</span>
          <span>${escapeHtml(p.name)}${p.id === state.playerId ? ' (tú)' : ''}</span>
        </span>
        <span class="pl-score">${p.totalScore.toFixed(2)}</span>`;
      wrap.appendChild(li);
    });
}

function markPlayerChecked(playerId) {
  const li = document.querySelector(`#multi-scoreboard li[data-player-id="${playerId}"]`);
  if (li && !li.querySelector('.checked-tag')) {
    const tag = document.createElement('span');
    tag.className = 'checked-tag';
    tag.textContent = '✔';
    li.querySelector('.pl-left').appendChild(tag);
  }
}

/* ----- Modal de resumen de ronda (multi) ----- */
function showRoundSummary(data) {
  $('summary-title').textContent = `Resultado · Ronda ${data.round} / ${data.totalRounds}`;
  // El color objetivo es sólido (sin transparencia): basta con pintarlo.
  $('summary-original').style.backgroundColor = data.originalColorString;
  $('summary-original-text').textContent = data.originalHsbString || data.originalColorString;

  const list = $('summary-list');
  list.innerHTML = '';
  data.results
    .slice()
    .sort((a, b) => b.roundScore - a.roundScore)
    .forEach((r) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="pl-left">
          <span class="player-avatar" style="background:${avatarColor(r.playerId)}">${r.name.charAt(0).toUpperCase()}</span>
          <span>${escapeHtml(r.name)}${r.playerId === state.playerId ? ' (tú)' : ''}</span>
        </span>
        <span class="pl-score">+${r.roundScore.toFixed(2)}</span>`;
      list.appendChild(li);
    });

  const isLast = data.round >= data.totalRounds;
  $('summary-next').textContent = isLast
    ? 'Calculando clasificación final…'
    : 'La siguiente ronda comenzará en unos segundos…';
  openModal();
}

function showMultiResults(leaderboard) {
  Sound.gameEnd();
  showScreen('screen-results');
  const max = TOTAL_ROUNDS * 10;
  const rows = leaderboard
    .map((p, i) => `
      <li class="${i === 0 ? 'rank-1' : ''}">
        <span class="pl-left">
          <span class="rank-num">${i + 1}</span>
          <span class="player-avatar" style="background:${avatarColor(p.id)}">${p.name.charAt(0).toUpperCase()}</span>
          <span>${escapeHtml(p.name)}${p.id === state.playerId ? ' (tú)' : ''}</span>
        </span>
        <strong>${p.totalScore.toFixed(2)} / ${max}</strong>
      </li>`)
    .join('');
  $('results-content').innerHTML = `
    <h3>🏆 Clasificación final</h3>
    <ul class="leaderboard">${rows}</ul>
  `;

  // Solo el anfitrión puede reiniciar; los demás vuelven al menú.
  $('btn-restart').style.display = state.playerId === state.hostId ? '' : 'none';
}

/* ----- Modal helpers ----- */
function openModal() { $('round-summary-modal').classList.remove('hidden'); }
function closeModal() { $('round-summary-modal').classList.add('hidden'); }

/* ----- Errores y utilidades ----- */
function showEntryError(msg) {
  $('entry-error').textContent = msg;
  setTimeout(() => { $('entry-error').textContent = ''; }, 4000);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* =========================================================
   8. Botón "Comprobar" (enruta según el modo)
   ========================================================= */
btnCheck.addEventListener('click', () => {
  if (state.mode === 'solo') checkSolo();
  else if (state.mode === 'multi') checkMulti();
});

/* =========================================================
   9. Tema claro/oscuro
   ========================================================= */
function initTheme() {
  const saved = localStorage.getItem('mtc-theme');
  if (saved === 'light') {
    document.body.classList.add('light');
    $('theme-toggle').textContent = '☀️';
  }
}
$('theme-toggle').addEventListener('click', () => {
  const light = document.body.classList.toggle('light');
  $('theme-toggle').textContent = light ? '☀️' : '🌙';
  localStorage.setItem('mtc-theme', light ? 'light' : 'dark');
});

/* =========================================================
   10. Cableado de botones del menú y navegación
   ========================================================= */
function initNav() {
  // Menú principal
  $('btn-solo').addEventListener('click', startSoloGame);
  $('btn-multi').addEventListener('click', () => {
    ensureSocket(); // conectamos al backend al entrar en multijugador
    showScreen('screen-lobby-entry');
  });

  // Botones "volver" / navegación por data-goto
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.goto));
  });

  // Lobby multijugador
  $('btn-create-room').addEventListener('click', createRoom);
  $('btn-join-room').addEventListener('click', joinRoom);
  $('input-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Sala de espera
  $('btn-leave-room').addEventListener('click', leaveRoom);
  $('btn-start-game').addEventListener('click', startMultiGame);
  $('btn-rename').addEventListener('click', renamePlayer);
  $('input-rename').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renamePlayer();
  });
  $('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(state.roomCode || '').then(() => {
      $('btn-copy-code').textContent = '✅';
      setTimeout(() => { $('btn-copy-code').textContent = '📋'; }, 1200);
    });
  });

  // Resultados finales
  $('btn-restart').addEventListener('click', () => {
    if (state.mode === 'solo') startSoloGame();
    else restartMulti();
  });
}

/* =========================================================
   11. Sonido: botón de activar/silenciar
   ========================================================= */
function initSound() {
  const btn = $('sound-toggle');
  btn.textContent = Sound.enabled ? '🔊' : '🔇';
  btn.addEventListener('click', () => {
    const on = Sound.toggle();
    btn.textContent = on ? '🔊' : '🔇';
  });
}

/* =========================================================
   12. Arranque
   ========================================================= */
initTheme();
initSound();
initNav();
showScreen('screen-menu');
