/**
 * server.js
 * ---------
 * Servidor en tiempo real para el juego "Match The Color".
 *
 * Tecnologías: Express (HTTP) + Socket.IO (WebSockets) + CORS.
 * Estado en memoria (sin base de datos) gestionado por rooms.js.
 *
 * Flujo multijugador:
 *   create_room  -> crea sala y devuelve código
 *   join_room    -> un jugador entra con el código
 *   start_game   -> el anfitrión inicia; el servidor emite round_start
 *   submit_check -> cada jugador envía su color; el servidor puntúa
 *   round_end    -> cuando TODOS han comprobado, se revelan resultados
 *   game_end     -> tras 5 rondas, clasificación final
 */

'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const game = require('./game');
const roomsApi = require('./rooms');

const PORT = process.env.PORT || 3000;
// Origen permitido para CORS. En producción puedes fijar la URL de Vercel.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

// ----- Servidor HTTP + Express -----
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

// Endpoint de salud (útil para Render/Railway y para comprobar que vive).
app.get('/', (_req, res) => {
  res.json({ status: 'ok', game: 'Match The Color', rooms: roomsApi.rooms.size });
});

const server = http.createServer(app);

// ----- Socket.IO -----
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

const DELAY = game.MEMORIZE_MS;     // 3 s de memorización sincronizada.
const ROUND_SUMMARY_MS = 4000;      // Tiempo mostrando el resumen de ronda.

// Temporizadores activos por sala (para cancelarlos si la sala se vacía).
const roundTimers = new Map();

/**
 * Emite a toda la sala el estado actualizado de jugadores y partida.
 */
function broadcastRoom(room) {
  io.to(room.code).emit('room_update', {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    currentRound: room.currentRound,
    totalRounds: game.TOTAL_ROUNDS,
    players: roomsApi.playersPublic(room),
    minPlayers: roomsApi.MIN_PLAYERS,
    maxPlayers: roomsApi.MAX_PLAYERS,
  });
}

/**
 * Inicia una nueva ronda: genera color, lo guarda y lo emite a todos.
 * El cliente mostrará el color durante MEMORIZE_MS y luego los sliders.
 */
function startRound(room) {
  room.currentRound += 1;
  room.roundColor = game.randomColor();
  room.checked.clear();
  room.status = 'playing';

  io.to(room.code).emit('round_start', {
    round: room.currentRound,
    totalRounds: game.TOTAL_ROUNDS,
    color: room.roundColor,                 // {h,s,v}
    colorString: game.colorToString(room.roundColor),
    memorizeMs: DELAY,
  });
  broadcastRoom(room);
}

/**
 * Finaliza la ronda actual: revela resultados y programa la siguiente
 * ronda o el final de la partida.
 */
function endRound(room) {
  // Construir los resultados de la ronda para cada jugador.
  const results = Array.from(room.players.values()).map((p) => {
    const entry = room.checked.get(p.id);
    return {
      playerId: p.id,
      name: p.name,
      roundScore: entry ? entry.score : 0,   // si no comprobó, 0 en la ronda
      guess: entry ? entry.guess : null,
      totalScore: Math.round(p.totalScore * 100) / 100,
    };
  });

  io.to(room.code).emit('round_end', {
    round: room.currentRound,
    totalRounds: game.TOTAL_ROUNDS,
    originalColor: room.roundColor,
    originalColorString: game.colorToString(room.roundColor),   // rgb(...) para pintar
    originalHsbString: game.colorToHsbString(room.roundColor),  // hsb(...) legible
    results,
  });

  // ¿Era la última ronda?
  if (room.currentRound >= game.TOTAL_ROUNDS) {
    room.status = 'finished';
    const leaderboard = roomsApi
      .playersPublic(room)
      .sort((a, b) => b.totalScore - a.totalScore);
    io.to(room.code).emit('game_end', { leaderboard });
    broadcastRoom(room);
  } else {
    // Programar el inicio de la siguiente ronda tras el resumen.
    const timer = setTimeout(() => {
      roundTimers.delete(room.code);
      // La sala podría haberse vaciado mientras tanto.
      if (roomsApi.rooms.has(room.code)) startRound(room);
    }, ROUND_SUMMARY_MS);
    roundTimers.set(room.code, timer);
  }
}

// ----- Manejo de conexiones de sockets -----
io.on('connection', (socket) => {
  // En qué sala está este socket (para limpiar en disconnect).
  socket.data.roomCode = null;

  /**
   * Crear una sala. callback({ ok, code, playerId }) o ({ ok:false, error }).
   */
  socket.on('create_room', ({ name } = {}, callback) => {
    const room = roomsApi.createRoom(socket.id, name);
    socket.join(room.code);
    socket.data.roomCode = room.code;

    if (typeof callback === 'function') {
      callback({ ok: true, code: room.code, playerId: socket.id });
    }
    broadcastRoom(room);
  });

  /**
   * Unirse a una sala existente por código.
   */
  socket.on('join_room', ({ code, name } = {}, callback) => {
    code = (code || '').toUpperCase().trim();
    const result = roomsApi.joinRoom(code, socket.id, name);

    if (!result.ok) {
      if (typeof callback === 'function') callback({ ok: false, error: result.error });
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;

    if (typeof callback === 'function') {
      callback({ ok: true, code, playerId: socket.id });
    }
    broadcastRoom(result.room);
  });

  /**
   * El anfitrión inicia la partida. Requiere mínimo de jugadores.
   */
  socket.on('start_game', (_data, callback) => {
    const room = roomsApi.rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Solo el anfitrión puede iniciar.' });
      }
      return;
    }
    if (room.players.size < roomsApi.MIN_PLAYERS) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: `Se necesitan al menos ${roomsApi.MIN_PLAYERS} jugadores.` });
      }
      return;
    }
    if (room.status === 'playing') return;

    room.currentRound = 0;
    if (typeof callback === 'function') callback({ ok: true });
    startRound(room);
  });

  /**
   * Un jugador envía su color comprobado. El servidor calcula la puntuación.
   */
  socket.on('submit_check', ({ guess } = {}, callback) => {
    const room = roomsApi.rooms.get(socket.data.roomCode);
    if (!room || room.status !== 'playing' || !room.roundColor) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    // Evitar doble comprobación en la misma ronda.
    if (room.checked.has(socket.id)) {
      if (typeof callback === 'function') {
        callback({ ok: true, score: room.checked.get(socket.id).score });
      }
      return;
    }

    // Saneamos lo recibido y puntuamos con la fórmula oficial del servidor.
    const safeGuess = game.sanitizeGuess(guess);
    const score = game.scoreRound(room.roundColor, safeGuess);

    player.roundScores.push(score);
    player.totalScore += score;
    room.checked.set(socket.id, { score, guess: safeGuess });

    // Devolvemos al propio jugador su puntuación inmediatamente.
    if (typeof callback === 'function') {
      callback({ ok: true, score, totalScore: Math.round(player.totalScore * 100) / 100 });
    }

    // Avisamos a los demás de que este jugador ya comprobó (sin revelar score).
    io.to(room.code).emit('player_checked', {
      playerId: socket.id,
      name: player.name,
      checkedCount: room.checked.size,
      totalPlayers: room.players.size,
    });

    // Si todos han comprobado, cerramos la ronda.
    if (roomsApi.allChecked(room)) {
      endRound(room);
    }
  });

  /**
   * El anfitrión reinicia la partida tras el final.
   */
  socket.on('restart_game', (_data, callback) => {
    const room = roomsApi.rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Solo el anfitrión puede reiniciar.' });
      }
      return;
    }
    // Cancelar cualquier temporizador pendiente.
    if (roundTimers.has(room.code)) {
      clearTimeout(roundTimers.get(room.code));
      roundTimers.delete(room.code);
    }
    roomsApi.resetRoom(room);
    if (typeof callback === 'function') callback({ ok: true });
    broadcastRoom(room);
  });

  /**
   * Salida explícita de la sala (sin cerrar el socket).
   */
  socket.on('leave_room', () => {
    handleLeave(socket);
  });

  /**
   * Desconexión (cierre de pestaña, pérdida de red, etc.).
   */
  socket.on('disconnect', () => {
    handleLeave(socket);
  });
});

/**
 * Lógica común al abandonar una sala (por salida explícita o desconexión).
 */
function handleLeave(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const { room, deleted, newHost } = roomsApi.removePlayer(code, socket.id);
  socket.leave(code);
  socket.data.roomCode = null;

  if (deleted) {
    // Sala vacía: limpiar temporizadores asociados.
    if (roundTimers.has(code)) {
      clearTimeout(roundTimers.get(code));
      roundTimers.delete(code);
    }
    return;
  }
  if (!room) return;

  // Notificar a los demás de la salida y el posible nuevo anfitrión.
  io.to(code).emit('player_left', {
    playerId: socket.id,
    newHost: newHost || room.hostId,
  });
  broadcastRoom(room);

  // Si la partida estaba en juego y, tras la salida, todos los que quedan
  // ya habían comprobado, cerramos la ronda para no bloquear la partida.
  if (room.status === 'playing' && roomsApi.allChecked(room)) {
    endRound(room);
  }
}

server.listen(PORT, () => {
  console.log(`🎨 Match The Color server escuchando en el puerto ${PORT}`);
});
