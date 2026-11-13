// Pruebas de las funciones puras del buscador de productos (js/buscador-producto.js), sin navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../js/buscador-producto.js');

const texto = partes => partes.map(p => (p.r ? `[${p.t}]` : p.t)).join('');

test('resalta lo escrito sin importar mayúsculas ni tildes', () => {
  assert.equal(texto(B.partesResaltadas('MOCHILA NBA LAKERS', 'mochi')), '[MOCHI]LA NBA LAKERS');
  assert.equal(texto(B.partesResaltadas('Riñonera Skora', 'rinon')), '[Riñon]era Skora');
  assert.equal(texto(B.partesResaltadas('Cartuchera 1 División', 'division')), 'Cartuchera 1 [División]');
});

test('varias palabras: se resalta cada una, en cualquier orden', () => {
  assert.equal(texto(B.partesResaltadas('MOCHILA NBA LAKERS', 'lakers mochila')), '[MOCHILA] NBA [LAKERS]');
  assert.equal(texto(B.partesResaltadas('Mochila Trendy Mochila', 'mochila')), '[Mochila] Trendy [Mochila]');
});

test('lo que se superpone se junta en un solo tramo', () => {
  assert.equal(texto(B.partesResaltadas('cartuchera', 'cart tuch')), '[cartuch]era');
  assert.equal(texto(B.partesResaltadas('banana', 'ana')), 'b[ana]na');
});

test('sin coincidencia o sin texto devuelve el texto entero sin resaltar', () => {
  assert.deepEqual(B.partesResaltadas('Billetera', 'zzz'), [{ t: 'Billetera', r: false }]);
  assert.deepEqual(B.partesResaltadas('Billetera', ''), [{ t: 'Billetera', r: false }]);
  assert.deepEqual(B.partesResaltadas('', 'a'), [{ t: '', r: false }]);
});

test('quitarTildes', () => {
  assert.equal(B.quitarTildes('Ñandú Éxito'), 'Nandu Exito');
});
