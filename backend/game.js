/**
 * game.js
 * -------
 * Lógica pura del juego (sin dependencias de red).
 * Se mantiene aislada para poder reutilizarla y testearla con facilidad.
 *
 * El servidor es la ÚNICA fuente de verdad: genera los colores y calcula
 * las puntuaciones. El cliente nunca decide la puntuación final.
 *
 * MODELO DE COLOR: HSB / HSV
 *   - h (HUE / tono):        0-360  (circular: 0 y 360 son el mismo color)
 *   - s (Saturación):        0-100
 *   - v (Brightness/Brillo): 0-100
 */

'use strict';

// ----- Constantes del juego -----
const TOTAL_ROUNDS = 5;        // Número de rondas por partida.
const MEMORIZE_MS = 3000;      // Duración de la fase de memorización (3 s).
const MAX_ROUND_SCORE = 10;    // Puntuación máxima por ronda.

// Rangos de generación. Evitamos saturaciones/brillos muy bajos para que el
// tono (HUE) siempre sea perceptible: así el juego es realmente "de color"
// y no salen colores casi negros o casi grises imposibles de memorizar.
const GEN_SAT_MIN = 25;
const GEN_VAL_MIN = 30;

/**
 * Genera un color aleatorio en formato HSB.
 * @returns {{h:number, s:number, v:number}}
 */
function randomColor() {
  const randRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  return {
    h: Math.floor(Math.random() * 360),   // 0-359
    s: randRange(GEN_SAT_MIN, 100),        // 25-100
    v: randRange(GEN_VAL_MIN, 100),        // 30-100
  };
}

/**
 * Convierte HSB/HSV a RGB (0-255) para poder pintarlo en CSS.
 * @param {{h,s,v}} c
 * @returns {{r,g,b}}
 */
function hsvToRgb({ h, s, v }) {
  const S = s / 100;
  const V = v / 100;
  const C = V * S;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = V - C;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = C; g1 = X; b1 = 0; }
  else if (h < 120) { r1 = X; g1 = C; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = C; b1 = X; }
  else if (h < 240) { r1 = 0; g1 = X; b1 = C; }
  else if (h < 300) { r1 = X; g1 = 0; b1 = C; }
  else { r1 = C; g1 = 0; b1 = X; }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Texto CSS del color (rgb) listo para pintar.
 * @param {{h,s,v}} c
 * @returns {string} ej: "rgb(120, 45, 200)"
 */
function colorToString(c) {
  const { r, g, b } = hsvToRgb(c);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Texto HSB legible (se usa solo al revelar el resultado, nunca al memorizar).
 * @param {{h,s,v}} c
 * @returns {string} ej: "hsb(210, 60%, 80%)"
 */
function colorToHsbString(c) {
  return `hsb(${c.h}, ${c.s}%, ${c.v}%)`;
}

/**
 * Calcula la puntuación de una ronda comparando el color objetivo (HSB) con
 * el reproducido por el jugador. Cada canal se normaliza a [0,1] y el HUE se
 * trata como circular (la distancia máxima entre tonos es 180º):
 *
 *   err_hue = min(|h1-h2|, 360-|h1-h2|) / 180   // circular, 0-1
 *   err_sat = |s1-s2| / 100                      // 0-1
 *   err_bri = |v1-v2| / 100                      // 0-1
 *   err_norm = (err_hue + err_sat + err_bri) / 3 // 0-1
 *   puntuacion = max(0, 10 * (1 - err_norm))     // 0-10
 *
 * @param {{h,s,v}} original
 * @param {{h,s,v}} guess
 * @returns {number} Puntuación (0-10) redondeada a 2 decimales.
 */
function scoreRound(original, guess) {
  const rawHue = Math.abs(original.h - guess.h);
  const errHue = Math.min(rawHue, 360 - rawHue) / 180;
  const errSat = Math.abs(original.s - guess.s) / 100;
  const errBri = Math.abs(original.v - guess.v) / 100;

  const errNorm = (errHue + errSat + errBri) / 3;
  const score = Math.max(0, MAX_ROUND_SCORE * (1 - errNorm));

  return Math.round(score * 100) / 100;
}

/**
 * Saneamiento del color recibido del cliente (nunca confiar en el cliente).
 * @param {*} raw  Objeto potencialmente inseguro {h,s,v}.
 * @returns {{h,s,v}}
 */
function sanitizeGuess(raw) {
  raw = raw || {};
  const clamp = (v, max) => {
    const n = Math.round(Number(v));
    if (Number.isNaN(n)) return 0;
    return Math.min(max, Math.max(0, n));
  };
  return {
    h: clamp(raw.h, 360) % 360, // 360 -> 0 (circular)
    s: clamp(raw.s, 100),
    v: clamp(raw.v, 100),
  };
}

module.exports = {
  TOTAL_ROUNDS,
  MEMORIZE_MS,
  MAX_ROUND_SCORE,
  randomColor,
  hsvToRgb,
  colorToString,
  colorToHsbString,
  scoreRound,
  sanitizeGuess,
};
