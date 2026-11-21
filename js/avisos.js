// =====================================================================
//  Avisos (campanita de la barra): los "Lo piensa" que llevan más de
//  48 horas sin respuesta. El número de la campanita es cuántos son; al
//  tocarla se ve la lista y cada uno lleva a su tarjeta en "Lo piensan".
//  No hay "leído": un aviso se va cuando la consulta se cierra (o vence).
//
//  La función pura atrasadas() también corre en Node para las pruebas.
// =====================================================================
(function (global) {
  'use strict';

  const HORAS_AVISO = 48;

  // filas: consultas de R.api.abiertos(). Devuelve las abiertas con más de `horas` desde la consulta,
  // la más vieja primero.
  function atrasadas(filas, ahora = Date.now(), horas = HORAS_AVISO) {
    const limite = ahora - horas * 3600000;
    return (filas || [])
      .filter(c => c && c.estado_efectivo === 'lo_piensa' && !c.anulada && Date.parse(c.fecha_consulta) <= limite)
      .sort((a, b) => Date.parse(a.fecha_consulta) - Date.parse(b.fecha_consulta));
  }

  const puro = { atrasadas, HORAS_AVISO };
  if (typeof module !== 'undefined' && module.exports) { module.exports = puro; return; }

  const R = global.CMC;
  const { $, esc, hace, plural } = R.util;
  let lista = [];

  const quien = c => c.cliente_nombre || c.cliente_contacto || 'Sin datos del cliente';

  function pintar(filas) {
    lista = atrasadas(filas);
    const n = lista.length;
    const btn = $('btn-avisos'), num = $('avisos-num');
    num.textContent = n > 99 ? '99+' : String(n);
    num.hidden = !n;
    btn.classList.toggle('con-avisos', n > 0);
    const texto = n ? `${plural(n, 'consulta lleva', 'consultas llevan')} más de ${HORAS_AVISO} horas en "Lo piensan"` : 'Sin avisos';
    btn.title = texto;
    btn.setAttribute('aria-label', 'Avisos: ' + texto);
    if (!$('avisos-panel').hidden) pintarPanel();
  }

  function pintarPanel() {
    const todos = !R.estado.local;
    $('avisos-panel').innerHTML = `<div class="avisos-cab"><strong>Avisos</strong><span>"Lo piensan" con más de ${HORAS_AVISO} h</span></div>`
      + (lista.length
        ? `<ul class="avisos-lista">${lista.map(c => `<li><button type="button" data-aviso="${c.id}">
            <span class="avisos-quien">${esc(quien(c))}</span>
            <span class="avisos-det">Consultó ${esc(hace(c.fecha_consulta))} · ${esc(c.canal || '')}${todos && c.local ? ' · ' + esc(c.local) : ''}</span>
          </button></li>`).join('')}</ul>`
        : `<p class="avisos-vacio">No hay consultas esperando hace más de ${HORAS_AVISO} horas.</p>`)
      + `<a class="avisos-pie" href="#abiertos" data-avisos-todos>Ver todas en Lo piensan</a>`;
  }

  function abrir(si) {
    const panel = $('avisos-panel');
    panel.hidden = !si;
    $('btn-avisos').setAttribute('aria-expanded', String(si));
    if (!si) return;
    pintarPanel();
    // En el celular el panel va fijo (la barra se parte en dos renglones): justo debajo de la campanita
    panel.style.top = global.matchMedia('(max-width: 640px)').matches ? Math.round($('btn-avisos').getBoundingClientRect().bottom + 8) + 'px' : '';
  }

  // Ir a la tarjeta en "Lo piensan" y marcarla un momento
  function irA(id) {
    abrir(false);
    R.estado.resaltar = id;
    if (location.hash === '#abiertos') R.app.refrescar();
    else location.hash = '#abiertos';
  }

  function iniciar() {
    const btn = $('btn-avisos');
    btn.addEventListener('click', e => { e.stopPropagation(); abrir($('avisos-panel').hidden); });
    $('avisos-panel').addEventListener('click', e => {
      const b = e.target.closest('[data-aviso]');
      if (b) return irA(Number(b.dataset.aviso));
      if (e.target.closest('[data-avisos-todos]')) abrir(false);
    });
    document.addEventListener('click', e => { if (!$('avisos-panel').hidden && !e.target.closest('#avisos')) abrir(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('avisos-panel').hidden) { abrir(false); btn.focus(); } });
  }

  R.avisos = { iniciar, pintar, atrasadas, HORAS_AVISO, esAtrasada: c => atrasadas([c]).length > 0 };
})(typeof window !== 'undefined' ? window : globalThis);
