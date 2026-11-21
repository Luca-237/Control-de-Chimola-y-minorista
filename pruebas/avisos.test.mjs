// Pruebas de la campanita de avisos (js/avisos.js), sin navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../js/avisos.js');

const ahora = Date.parse('2026-11-21T12:00:00-03:00');
const horasAtras = h => new Date(ahora - h * 3600000).toISOString();
const c = (id, h, extra = {}) => ({ id, fecha_consulta: horasAtras(h), estado_efectivo: 'lo_piensa', anulada: false, ...extra });

test('avisa solo los "Lo piensa" abiertos con 48 horas o más, el más viejo primero', () => {
  const r = A.atrasadas([
    c(1, 47.9), c(2, 48), c(3, 120), c(4, 72),
    c(5, 400, { estado_efectivo: 'vencida' }), c(6, 90, { anulada: true }),
  ], ahora);
  assert.deepEqual(r.map(x => x.id), [3, 4, 2]);
});

test('sin filas no hay avisos; las horas se pueden cambiar', () => {
  assert.deepEqual(A.atrasadas(null, ahora), []);
  assert.equal(A.HORAS_AVISO, 48);
  assert.deepEqual(A.atrasadas([c(1, 30)], ahora, 24).map(x => x.id), [1]);
});
