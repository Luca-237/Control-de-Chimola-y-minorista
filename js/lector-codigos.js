// =====================================================================
//  Pistola de código de barras (lector USB o Bluetooth).
//  La pistola "escribe" el código como un teclado muy rápido y termina con
//  Enter (o Tab). Acá se distingue eso de alguien tecleando: muchos
//  caracteres seguidos con menos de ~35 ms entre uno y otro.
//  No importa dónde esté el cursor: si el código cayó en otra casilla
//  (cantidad, monto, detalle…), se le devuelve lo que tenía antes y el
//  código va al formulario de venta que esté a la vista.
//
//  La función pura esLectura() también corre en Node para las pruebas.
// =====================================================================
(function (global) {
  'use strict';

  const MIN_CARACTERES = 4;   // los códigos más cortos no se distinguen de teclear
  const MAX_PROMEDIO_MS = 35; // una persona rápida tarda 80 ms o más entre teclas; una pistola, 5 a 20 ms
  const MAX_SALTO_MS = 80;    // si entre dos caracteres pasa más que esto, empieza otra lectura

  // tiempos: momento (ms) de cada carácter y, al final, el del Enter / Tab
  function esLectura(tiempos) {
    if (!Array.isArray(tiempos) || tiempos.length < MIN_CARACTERES + 1) return false;
    let total = 0, mayor = 0;
    for (let i = 1; i < tiempos.length; i++) {
      const d = tiempos[i] - tiempos[i - 1];
      if (d < 0) return false;
      total += d;
      mayor = Math.max(mayor, d);
    }
    return mayor <= MAX_SALTO_MS && total / (tiempos.length - 1) <= MAX_PROMEDIO_MS;
  }

  const puro = { esLectura, MIN_CARACTERES, MAX_PROMEDIO_MS, MAX_SALTO_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = puro; return; }

  // Formularios que reciben lecturas: contenedor -> alLeer(codigo, elementoDondeCayo)
  const receptores = new Map();
  let lectura = null; // { texto, tiempos, el, valorAntes }

  const editable = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const visible = el => el.isConnected && !!(el.offsetParent || el.getClientRects().length);

  // ¿A qué formulario va? Al que tiene el cursor; si el cursor no está en una casilla, al que está a la vista
  // (dentro del diálogo abierto, si hay uno).
  function receptorPara(el) {
    for (const [cont, fn] of receptores) if (!cont.isConnected) receptores.delete(cont);
    for (const [cont, fn] of receptores) if (cont.contains(el)) return fn;
    if (editable(el)) return null;
    const dialogo = [...document.querySelectorAll('dialog[open]')].pop();
    for (const [cont, fn] of [...receptores].reverse()) {
      if (!visible(cont)) continue;
      if (dialogo ? dialogo.contains(cont) : !cont.closest('dialog')) return fn;
    }
    return null;
  }

  function alTeclear(e) {
    const ahora = e.timeStamp || performance.now();
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!lectura || ahora - lectura.tiempos[lectura.tiempos.length - 1] > MAX_SALTO_MS) {
        const el = e.target;
        lectura = { texto: '', tiempos: [], el, valorAntes: editable(el) && 'value' in el ? el.value : null };
      }
      lectura.texto += e.key;
      lectura.tiempos.push(ahora);
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && lectura && ahora - lectura.tiempos[lectura.tiempos.length - 1] <= MAX_SALTO_MS
        && esLectura([...lectura.tiempos, ahora])) {
      const { texto, el, valorAntes } = lectura;
      lectura = null;
      const fn = receptorPara(el);
      if (!fn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Lo que la pistola escribió en la casilla donde estaba el cursor se borra (vuelve a lo que tenía)
      if (valorAntes != null && el.value !== valorAntes) {
        el.value = valorAntes;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      fn(texto.trim(), el);
      return;
    }
    if (e.key !== 'Shift') lectura = null;
  }

  // Fase de captura: se entera antes que las casillas (así el Enter de la pistola no elige ni envía nada)
  document.addEventListener('keydown', alTeclear, true);

  global.CMC.lectorCodigos = {
    esLectura,
    // Un formulario por contenedor (si se vuelve a armar, reemplaza al anterior)
    registrar(cont, alLeer) { receptores.delete(cont); receptores.set(cont, alLeer); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
