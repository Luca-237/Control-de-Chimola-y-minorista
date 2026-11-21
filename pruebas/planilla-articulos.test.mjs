// Pruebas de la lectura de la planilla de artículos propia (js/planilla-articulos.js), sin navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../js/planilla-articulos.js');

test('encuentra las columnas aunque estén en otro orden y con tildes rotas; ignora precios y promos', () => {
  const r = P.filasDeMatriz([
    ['Descripci�n', 'Rubro', 'CODIGO', 'Temporada', 'Precio Venta Publico', 'Promo'],
    ['Llavero dog', 'Accesorios', 'BT256', 'Invierno 2025', 4400, '3x2'],
    ['  Cartera   Tejida ', 'Accesorios', ' TX64 ', 'DDN26', 18000, 0.2],
  ]);
  assert.deepEqual(r.filas, [
    { codigo: 'BT256', nombre: 'Llavero dog', rubro: 'Accesorios', temporada: 'Invierno 2025' },
    { codigo: 'TX64', nombre: 'Cartera Tejida', rubro: 'Accesorios', temporada: 'DDN26' },
  ]);
});

test('cabecera más abajo, columna "Artículo" como código, sin rubro ni temporada', () => {
  const r = P.filasDeMatriz([[], ['', 'Artículo', 'Descripción'], ['', 'L01-G', 'VALIJA GRANDE VERMON']]);
  assert.deepEqual(r.filas, [{ codigo: 'L01-G', nombre: 'VALIJA GRANDE VERMON', rubro: '', temporada: '' }]);
});

test('salta vacíos, #N/A y repetidos, y los cuenta', () => {
  const r = P.filasDeMatriz([
    ['Codigo', 'Descripcion'],
    ['A1', 'Uno'], ['', 'sin código'], ['A2', '#N/A'], ['a1', 'Uno repetido'], ['#N/A', 'x'],
  ]);
  assert.deepEqual(r.filas.map(f => f.codigo), ['A1']);
  assert.equal(r.repetidos, 1);
  assert.equal(r.sinNombre, 1);
});

test('una hoja sin las columnas no sirve', () => {
  assert.equal(P.filasDeMatriz([['Precio', 'Stock'], [1, 2]]), null);
  assert.equal(P.filasDeMatriz(null), null);
});
