// Pruebas de la pistola de código de barras (js/lector-codigos.js): distinguir una lectura de alguien tecleando.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/lector-codigos.js');

const cada = (n, ms, desde = 1000) => Array.from({ length: n }, (_, i) => desde + i * ms);

test('una pistola (13 caracteres a 10 ms y Enter) es una lectura', () => {
  assert.equal(L.esLectura(cada(14, 10)), true);
  assert.equal(L.esLectura(cada(14, 30)), true);
});

test('alguien tecleando, aunque sea rápido, no es una lectura', () => {
  assert.equal(L.esLectura(cada(14, 90)), false);
  assert.equal(L.esLectura(cada(6, 60)), false);
});

test('muy pocos caracteres, una pausa en el medio o tiempos raros no son una lectura', () => {
  assert.equal(L.esLectura(cada(3, 5)), false);                     // 2 caracteres + Enter
  assert.equal(L.esLectura([1000, 1010, 1020, 1200, 1210, 1220]), false);
  assert.equal(L.esLectura([1000, 990, 1000, 1010, 1020]), false);
  assert.equal(L.esLectura(null), false);
});
