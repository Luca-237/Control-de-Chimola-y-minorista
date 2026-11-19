// =====================================================================
//  Buscador de productos "mientras se escribe" (autocompletar).
//  Escribís parte del nombre (o el código) y aparece la lista de productos de
//  Odoo, con o sin stock (uno por nombre y categoría, ver la función
//  buscar-productos). Se elige con el mouse, el dedo o las flechas + Enter.
//  Si el producto no está, "Cargar «…» igual" lo deja cargar con el nombre
//  escrito y el rubro de la lista de siempre.
//  Cuida el límite de pedidos de la API: espera 250 ms después de la última
//  tecla, busca desde 2 letras, cancela la búsqueda anterior y recuerda lo
//  ya buscado.
//
//  Las funciones puras (quitarTildes, partesResaltadas) también corren en
//  Node para las pruebas.
// =====================================================================
(function (global) {
  'use strict';

  const quitarTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Divide un texto en tramos y marca los que coinciden con las palabras buscadas (sin importar mayúsculas ni tildes)
  // -> [{ t: "texto", r: true | false }]
  function partesResaltadas(texto, consulta) {
    texto = String(texto || '');
    const plano = quitarTildes(texto).toLowerCase();
    if (plano.length !== texto.length) return [{ t: texto, r: false }]; // caracteres combinados raros: sin resaltar
    const marcas = [];
    for (const palabra of quitarTildes(consulta).toLowerCase().split(/\s+/).filter(Boolean)) {
      for (let desde = 0, i; (i = plano.indexOf(palabra, desde)) >= 0; desde = i + palabra.length) marcas.push([i, i + palabra.length]);
    }
    marcas.sort((a, b) => a[0] - b[0]);
    const juntas = [];
    for (const m of marcas) {
      const ult = juntas[juntas.length - 1];
      if (ult && m[0] <= ult[1]) ult[1] = Math.max(ult[1], m[1]); else juntas.push([...m]);
    }
    const partes = [];
    let pos = 0;
    for (const [a, b] of juntas) {
      if (a > pos) partes.push({ t: texto.slice(pos, a), r: false });
      partes.push({ t: texto.slice(a, b), r: true });
      pos = b;
    }
    if (pos < texto.length) partes.push({ t: texto.slice(pos), r: false });
    return partes.length ? partes : [{ t: texto, r: false }];
  }

  const puro = { quitarTildes, partesResaltadas };
  if (typeof module !== 'undefined' && module.exports) { module.exports = puro; return; }

  const R = global.CMC;
  const { esc, ICONOS } = R.util;
  const ESPERA_MS = 250, MIN_LETRAS = 2, LIMITE = 8;
  let contador = 0;

  const resaltado = (texto, q) => partesResaltadas(texto, q).map(p => (p.r ? `<mark>${esc(p.t)}</mark>` : esc(p.t))).join('');

  // cont: donde se dibuja. opciones:
  //   inicial   { modo: 'catalogo' | 'libre' | null, producto, categoria, categoria_ruta }  lo ya elegido
  //   alElegir  (resultado)  se eligió un producto de la lista
  //   alLibre   (texto)      se eligió cargarlo fuera del catálogo (texto = lo que se había escrito)
  //   alCambiar ()           se tocó "Cambiar" (vuelve a buscar)
  function crear(cont, { inicial = {}, alElegir, alLibre, alCambiar } = {}) {
    const id = 'bp' + (++contador);
    const memoria = new Map();
    let temporizador = null, control = null, resultados = [], activo = -1, ultimaBusqueda = '', error = '', avisoVacio = '';

    cont.innerHTML = `<div class="bp">
      <div class="bp-elegido" hidden></div>
      <div class="bp-buscar">
        <input type="text" class="bp-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-lista" aria-label="Producto"
          autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" placeholder="Escribí el producto o pasá la pistola de códigos">
        <span class="bp-cargando" hidden aria-hidden="true"></span>
        <ul class="bp-lista" id="${id}-lista" role="listbox" hidden></ul>
      </div>
    </div>`;
    const caja = cont.querySelector('.bp'), input = cont.querySelector('.bp-input'), lista = cont.querySelector('.bp-lista');
    const elegidoEl = cont.querySelector('.bp-elegido'), cargando = cont.querySelector('.bp-cargando'), buscarEl = cont.querySelector('.bp-buscar');

    function pintarElegido() {
      const modo = inicial.modo;
      elegidoEl.hidden = !modo;
      buscarEl.hidden = !!modo;
      if (modo === 'catalogo') {
        elegidoEl.innerHTML = `<span class="bp-ico">${ICONOS.compro}</span><span class="bp-texto"><strong>${esc(inicial.producto)}</strong><small>${esc(inicial.categoria_ruta || inicial.categoria || '')}</small></span><button type="button" class="link" data-cambiar>Cambiar</button>`;
      } else if (modo === 'libre') {
        elegidoEl.innerHTML = `<span class="bp-texto"><strong>Tal como está (fuera del catálogo)</strong><small>Se guarda con el nombre de abajo</small></span><button type="button" class="link" data-cambiar>Buscar en el catálogo</button>`;
      }
    }

    function cerrar() {
      lista.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activo = -1;
    }

    function pintarLista() {
      const q = input.value.trim();
      const opciones = resultados.map((r, i) => `<li role="option" id="${id}-o${i}" data-i="${i}" aria-selected="${i === activo}">
          <span class="bp-nombre">${resaltado(r.nombre, q)}${r.con_stock === false ? ' <em class="bp-sin">Sin stock</em>' : r.publicado === false ? ' <em class="bp-sin">Sin publicar</em>' : ''}</span>
          <small>${esc([r.ruta || r.categoria || '', (r.codigos || []).length ? 'cód. ' + r.codigos[0] + (r.cantidad > 1 ? ` y ${r.cantidad - 1} más` : '') : '', typeof r.stock === 'number' && r.stock > 0 ? 'stock ' + R.util.fmtNum(r.stock) : ''].filter(Boolean).join(' · '))}</small></li>`).join('');
      const aviso = error ? `<li class="bp-aviso" role="presentation">${esc(error)}</li>`
        : !resultados.length && q.length >= MIN_LETRAS && ultimaBusqueda === q ? `<li class="bp-aviso" role="presentation">${esc(avisoVacio || `No encontramos "${q}" en Odoo.`)}</li>` : '';
      lista.innerHTML = opciones + aviso
        + `<li role="option" id="${id}-libre" data-libre aria-selected="${activo === resultados.length}" class="bp-libre"><span class="bp-nombre">Cargar este producto tal como está: <strong>${esc(q)}</strong></span><small>No está en el catálogo: se guarda con ese nombre</small></li>`;
      lista.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      const act = activo >= 0 ? lista.querySelector(`[aria-selected="true"]`) : null;
      if (act) { input.setAttribute('aria-activedescendant', act.id); act.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }

    async function buscar(q) {
      ultimaBusqueda = q;
      error = '';
      avisoVacio = '';
      if (control) control.abort();
      if (memoria.has(q)) { resultados = memoria.get(q); activo = -1; pintarLista(); return; }
      control = new AbortController();
      cargando.hidden = false;
      try {
        const r = await R.api.productos.buscar(q, { limite: LIMITE, senal: control.signal });
        memoria.set(q, r);
        if (q !== ultimaBusqueda) return;
        resultados = r;
      } catch (e) {
        if (e.name === 'AbortError') return;
        resultados = [];
        error = 'No se pudo buscar: ' + e.message;
      }
      cargando.hidden = true;
      activo = -1;
      pintarLista();
    }

    function alEscribir() {
      clearTimeout(temporizador);
      const q = input.value.trim().replace(/\s+/g, ' ');
      if (q.length < MIN_LETRAS) { if (control) control.abort(); cargando.hidden = true; resultados = []; error = ''; ultimaBusqueda = ''; cerrar(); return; }
      temporizador = setTimeout(() => buscar(q), ESPERA_MS);
    }

    function elegir(i) {
      if (i === resultados.length) { if (input.value.trim()) libre(); return; }
      const r = resultados[i];
      if (!r) return;
      clearTimeout(temporizador);
      cerrar();
      Object.assign(inicial, { modo: 'catalogo', producto: r.nombre, producto_clave: r.clave, categoria: r.categoria, categoria_ruta: r.ruta, categoria_tn_id: r.categoria_id });
      pintarElegido();
      if (alElegir) alElegir(r);
    }
    function libre() {
      clearTimeout(temporizador);
      cerrar();
      const texto = input.value.trim().replace(/\s+/g, ' ');
      Object.assign(inicial, { modo: 'libre' });
      pintarElegido();
      if (alLibre) alLibre(texto);
    }

    input.addEventListener('input', alEscribir);
    input.addEventListener('focus', () => { if (input.value.trim().length >= MIN_LETRAS && (resultados.length || error)) pintarLista(); });
    input.addEventListener('keydown', e => {
      const total = resultados.length + 1; // la última es "Otro producto"
      if (e.key === 'ArrowDown') { e.preventDefault(); if (lista.hidden) { if (input.value.trim().length >= MIN_LETRAS) { activo = 0; pintarLista(); } } else { activo = (activo + 1) % total; pintarLista(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!lista.hidden) { activo = activo <= 0 ? total - 1 : activo - 1; pintarLista(); } }
      else if (e.key === 'Enter') {
        if (!lista.hidden && activo >= 0) { e.preventDefault(); elegir(activo); }
        else if (!lista.hidden && resultados.length === 1) { e.preventDefault(); elegir(0); }
        else e.preventDefault(); // Enter no envía el formulario desde acá
      }
      else if (e.key === 'Escape') { if (!lista.hidden) { e.preventDefault(); e.stopPropagation(); cerrar(); } }
      else if (e.key === 'Tab') cerrar();
    });
    // mousedown (no click) para que el campo no pierda el foco antes de elegir
    lista.addEventListener('mousedown', e => {
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      e.preventDefault();
      if (li.hasAttribute('data-libre')) libre(); else elegir(Number(li.dataset.i));
    });
    lista.addEventListener('mousemove', e => {
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      const i = li.hasAttribute('data-libre') ? resultados.length : Number(li.dataset.i);
      if (i !== activo) { activo = i; lista.querySelectorAll('[role="option"]').forEach(x => x.setAttribute('aria-selected', String(x === li))); }
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 120));
    elegidoEl.addEventListener('click', e => {
      if (!e.target.closest('[data-cambiar]')) return;
      Object.assign(inicial, { modo: null });
      pintarElegido();
      input.value = '';
      resultados = []; error = ''; ultimaBusqueda = '';
      if (alCambiar) alCambiar();
      input.focus();
    });

    pintarElegido();
    // Muestra un código leído con la pistola que no encontró un único producto: la lista para elegir
    // (si hubo varios) o el aviso de que no está, con la opción de cargarlo tal como está
    function mostrar(texto, lista_, aviso = '') {
      clearTimeout(temporizador);
      if (control) control.abort();
      cargando.hidden = true;
      input.value = texto;
      ultimaBusqueda = texto.trim();
      resultados = lista_ || [];
      error = '';
      avisoVacio = aviso;
      activo = resultados.length ? 0 : -1;
      input.focus();
      pintarLista();
    }

    return { enfocar: () => input.focus(), mostrar, caja };
  }

  R.buscadorProducto = { crear, partesResaltadas, quitarTildes };
})(typeof window !== 'undefined' ? window : globalThis);
