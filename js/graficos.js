// =====================================================================
//  Gráficos del tablero, dibujados a mano (SVG y HTML) con los colores
//  del tema: se ven bien en claro, en oscuro y con el color de fondo
//  que elija cada uno. Cada elemento lleva data-tip: al pasar el mouse
//  (o tocar en el celular) aparece el globo con el dato exacto.
// =====================================================================
(function (R) {
  const { esc, fmtNum } = R.util;

  // Máximo "redondo" para el eje (1, 2, 2.5, 5 x 10^n)
  function techo(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  // En los globos los montos van completos ($ 534.120), aunque el eje o la barra los muestre cortos ($ 534 mil)
  const largo = f => (f === R.util.fmtPesosCorto ? v => R.util.fmtPesos(v) : f);
  const vacio = texto => `<p class="vacio">${esc(texto || "Sin datos en este período.")}</p>`;

  // Líneas (varias series sobre el mismo eje). puntos: [{etiqueta, ...valores}]
  function lineas(puntos, series, { formato = fmtNum, alto = 230, extra } = {}) {
    if (!puntos.length) return vacio();
    const W = 720, H = alto, ml = 44, mr = 12, mt = 12, mb = 28, iw = W - ml - mr, ih = H - mt - mb;
    const max = techo(Math.max(...puntos.flatMap(p => series.map(s => p[s.clave] || 0))));
    const n = puntos.length, x = i => ml + (n === 1 ? iw / 2 : (i * iw) / (n - 1)), y = v => mt + ih - (v / max) * ih;
    const grilla = [0, .25, .5, .75, 1].map(f => {
      const v = max * f, yy = y(v);
      return `<line class="eje" x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}"/><text class="eje-txt" x="${ml - 8}" y="${yy + 4}" text-anchor="end">${esc(formato(v))}</text>`;
    }).join("");
    const cada = Math.max(1, Math.ceil(n / 10));
    // Cada "cada" puntos una etiqueta, más la última (salvo que quede pegada a la anterior)
    const etiquetas = puntos.map((p, i) => (i % cada === 0 && (i === 0 || n - 1 - i >= cada / 2)) || i === n - 1
      ? `<text class="eje-txt" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.etiqueta)}</text>` : "").join("");
    const trazos = series.map(s => {
      const d = puntos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[s.clave] || 0).toFixed(1)}`).join("");
      const area = `${d}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
      const marcas = n <= 45 ? puntos.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p[s.clave] || 0).toFixed(1)}" r="${n > 20 ? 2.4 : 3.4}" fill="${s.color}"/>`).join("") : "";
      return `<path class="area" d="${area}" fill="${s.color}"/><path class="linea" d="${d}" stroke="${s.color}"/>${marcas}`;
    }).join("");
    const ancho = n === 1 ? iw : iw / (n - 1);
    const zonas = puntos.map((p, i) => {
      const tip = [p.titulo || p.etiqueta, ...series.map(s => `${s.nombre}: ${largo(formato)(p[s.clave] || 0)}`), ...(extra ? extra(p) : [])].join("\n");
      return `<rect class="zona" x="${(x(i) - ancho / 2).toFixed(1)}" y="${mt}" width="${ancho.toFixed(1)}" height="${ih}" data-tip="${esc(tip)}"/>`;
    }).join("");
    return `<svg class="graf-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución">${grilla}${etiquetas}${zonas}${trazos}</svg>`;   // las zonas van abajo: al resaltarse no tapan las líneas
  }

  // Columnas verticales (un valor por punto)
  function columnas(puntos, clave, { formato = fmtNum, color = "var(--naranja)", nombre = "", alto = 230 } = {}) {
    if (!puntos.length) return vacio();
    const W = 720, H = alto, ml = 56, mr = 12, mt = 12, mb = 28, iw = W - ml - mr, ih = H - mt - mb;
    const max = techo(Math.max(...puntos.map(p => p[clave] || 0)));
    const n = puntos.length, paso = iw / n, ancho = Math.max(2, Math.min(38, paso * .7));
    const y = v => mt + ih - (v / max) * ih;
    const grilla = [0, .25, .5, .75, 1].map(f => {
      const v = max * f, yy = y(v);
      return `<line class="eje" x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}"/><text class="eje-txt" x="${ml - 8}" y="${yy + 4}" text-anchor="end">${esc(formato(v))}</text>`;
    }).join("");
    const cada = Math.max(1, Math.ceil(n / 10));
    const barras = puntos.map((p, i) => {
      const v = p[clave] || 0, cx = ml + paso * i + paso / 2, yy = y(v);
      const tip = `${p.titulo || p.etiqueta}
${nombre ? nombre + ": " : ""}${largo(formato)(v)}`;
      const lbl = (i % cada === 0 || i === n - 1) ? `<text class="eje-txt" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(p.etiqueta)}</text>` : "";
      return `<rect class="zona" x="${(ml + paso * i).toFixed(1)}" y="${mt}" width="${paso.toFixed(1)}" height="${ih}" data-tip="${esc(tip)}"/>`
        + `<rect class="barra-v" x="${(cx - ancho / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${ancho.toFixed(1)}" height="${(mt + ih - yy).toFixed(1)}" rx="3" fill="${color}" pointer-events="none"/>${lbl}`;
    }).join("");
    return `<svg class="graf-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(nombre)}">${grilla}${barras}</svg>`;
  }

  // Barras horizontales ordenadas. lista: [{nombre, ...}]; valor: campo a medir
  function barras(lista, { valor = "monto", formato = fmtNum, detalle, color = "var(--naranja)", maximo = 8, total } = {}) {
    const filas = lista.filter(g => (g[valor] || 0) > 0);
    if (!filas.length) return vacio();
    let mostrar = filas.slice(0, maximo);
    if (filas.length > maximo) {
      const resto = filas.slice(maximo);
      const otros = { nombre: `Otros (${resto.length})`, otros: true };
      for (const k of ["monto", "ventas", "unidades", "consultas"]) otros[k] = resto.reduce((s, g) => s + (g[k] || 0), 0);
      mostrar = [...mostrar, otros];
    }
    const max = Math.max(...mostrar.map(g => g[valor] || 0));
    const suma = total ?? filas.reduce((s, g) => s + (g[valor] || 0), 0);
    return `<div class="barras">${mostrar.map(g => {
      const v = g[valor] || 0, pct = suma ? v / suma : 0;
      const det = detalle ? detalle(g) : "";
      const tip = [g.nombre, `${largo(formato)(v)} · ${R.util.fmtPct(pct)} del total`, det].filter(Boolean).join("\n");
      return `<div class="barra-h" data-tip="${esc(tip)}"><span class="nombre">${esc(g.nombre)}</span>`
        + `<span class="pista"><span class="relleno" style="width:${max ? Math.max(1.5, (v / max) * 100) : 0}%; --c:${g.otros ? "var(--tenue)" : color}"></span></span>`
        + `<span class="cifra">${esc(formato(v))}<small>${esc(R.util.fmtPct(pct, 0))}</small></span></div>`;
    }).join("")}</div>`;
  }

  // Recorrido de las consultas: cada paso relativo al primero
  function embudo(pasos) {
    const base = pasos[0] ? pasos[0].valor : 0;
    if (!base) return vacio();
    return `<div class="embudo">${pasos.map(p => {
      const pct = base ? p.valor / base : 0;
      const tip = `${p.nombre}
${fmtNum(p.valor)} · ${R.util.fmtPct(pct)} de las consultas`;
      return `<div class="embudo-paso" data-tip="${esc(tip)}"><span>${esc(p.nombre)}</span>`
        + `<span class="pista"><span class="relleno" style="width:${Math.max(0, pct * 100)}%; --c:${p.color}">${fmtNum(p.valor)} · ${R.util.fmtPct(pct, 0)}</span></span></div>`;
    }).join("")}</div>`;
  }

  // Mapa de calor día x hora. matriz[dia 0=lunes][hora]
  function calor(matriz) {
    const total = matriz.flat().reduce((a, b) => a + b, 0);
    if (!total) return vacio();
    let desde = 24, hasta = -1;
    matriz.forEach(f => f.forEach((v, h) => { if (v) { desde = Math.min(desde, h); hasta = Math.max(hasta, h); } }));
    desde = Math.min(desde, 9); hasta = Math.max(hasta, 20);
    const horas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
    const max = Math.max(...matriz.flat());
    const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
    let html = `<div class="calor" style="grid-template-columns:40px repeat(${horas.length}, minmax(22px, 1fr))"><span></span>`
      + horas.map(h => `<span class="hora">${h}</span>`).join("");
    matriz.forEach((fila, d) => {
      html += `<span class="dia">${window.Medidas.DIAS[d]}</span>` + horas.map(h => {
        const v = fila[h];
        const tip = `${DIAS_LARGOS[d][0].toUpperCase() + DIAS_LARGOS[d].slice(1)}, de ${h} a ${h + 1} h
${R.util.plural(v, "consulta", "consultas")}`;
        return `<span class="celda${v ? "" : " cero"}" style="${v ? `opacity:${(.18 + .82 * v / max).toFixed(2)}` : ""}" data-tip="${esc(tip)}"></span>`;
      }).join("");
    });
    return `<div class="calor-wrap">${html}</div></div>`;
  }

  R.graficos = { techo, lineas, columnas, barras, embudo, calor, vacio };
})(window.CMC);
