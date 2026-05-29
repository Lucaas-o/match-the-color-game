/**
 * rooms.js
 * --------
 * Gestión en memoria de las salas multijugador (sin base de datos).
 *
 * Estructura de una sala:
 * {
 *   code:         "ABC123",                // código único de 6 caracteres
 *   hostId:       "<socketId>",            // jugador anfitrión
 *   status:       "lobby"|"playing"|"finished",
 *   currentRound: 0,                       // ronda actual (1..TOTAL_ROUNDS)
 *   roundColor:   {h,s,v} | null,          // color objetivo de la ronda activa
 *   players: Map<socketId, {
 *     id, name, totalScore, roundScores: number[]
 *   }>,
 *   checked: Map<socketId, {score, guess}> // quién ya comprobó en la ronda actual
 * }
 */

'use strict';

const { TOTAL_ROUNDS } = require('./game');

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const CODE_LENGTH = 6;
// Caracteres permitidos para el código (sin 0/O/1/I para evitar confusiones).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Mapa global de salas: code -> room
const rooms = new Map();

/** Genera un código aleatorio de 6 caracteres alfanuméricos en mayúsculas. */
function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/** Genera un código garantizado como único entre las salas existentes. */
function generateUniqueCode() {
  let code;
  do {
    code = generateCode();
  } while (rooms.has(code));
  return code;
}

/**
 * Crea una nueva sala y registra al anfitrión.
 * @returns {object} la sala creada
 */
function createRoom(hostSocketId, hostName) {
  const code = generateUniqueCode();
  const room = {
    code,
    hostId: hostSocketId,
    status: 'lobby',
    currentRound: 0,
    roundColor: null,
    players: new Map(),
    checked: new Map(),
  };
  room.players.set(hostSocketId, {
    id: hostSocketId,
    name: hostName || 'Jugador 1',
    totalScore: 0,
    roundScores: [],
  });
  rooms.set(code, room);
  return room;
}

/**
 * Añade un jugador a una sala existente.
 * @returns {{ok:boolean, room?:object, error?:string}}
 */
function joinRoom(code, socketId, name) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'La sala no existe.' };
  if (room.status !== 'lobby') {
    return { ok: false, error: 'La partida ya ha comenzado.' };
  }
  if (room.players.size >= MAX_PLAYERS) {
    return { ok: false, error: 'La sala está llena (máximo 4 jugadores).' };
  }
  const playerNumber = room.players.size + 1;
  room.players.set(socketId, {
    id: socketId,
    name: name || `Jugador ${playerNumber}`,
    totalScore: 0,
    roundScores: [],
  });
  return { ok: true, room };
}

/**
 * Elimina a un jugador de su sala. Si la sala queda vacía, se borra.
 * Si el anfitrión se va, se asigna un nuevo anfitrión.
 * @returns {{room?:object, removed:boolean, deleted:boolean, newHost?:string}}
 */
function removePlayer(code, socketId) {
  const room = rooms.get(code);
  if (!room) return { removed: false, deleted: false };

  const removed = room.players.delete(socketId);
  room.checked.delete(socketId);

  if (room.players.size === 0) {
    rooms.delete(code);
    return { removed, deleted: true };
  }

  let newHost;
  if (room.hostId === socketId) {
    // El anfitrión se fue: el primer jugador restante asume el rol.
    newHost = room.players.keys().next().value;
    room.hostId = newHost;
  }

  return { room, removed, deleted: false, newHost };
}

/** Devuelve un array serializable con la info pública de los jugadores. */
function playersPublic(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    totalScore: Math.round(p.totalScore * 100) / 100,
    roundScores: p.roundScores,
    isHost: p.id === room.hostId,
  }));
}

/** Indica si todos los jugadores de la sala ya han comprobado en la ronda. */
function allChecked(room) {
  return room.players.size > 0 && room.checked.size >= room.players.size;
}

/** Reinicia las puntuaciones de una sala para volver a jugar. */
function resetRoom(room) {
  room.status = 'lobby';
  room.currentRound = 0;
  room.roundColor = null;
  room.checked.clear();
  for (const p of room.players.values()) {
    p.totalScore = 0;
    p.roundScores = [];
  }
}

module.exports = {
  rooms,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TOTAL_ROUNDS,
  createRoom,
  joinRoom,
  removePlayer,
  playersPublic,
  allChecked,
  resetRoom,
};
