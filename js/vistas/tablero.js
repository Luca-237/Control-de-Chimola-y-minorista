// =====================================================================
//  Vista: Tablero (admin y consulta). Período, comparación, canal y
//  vendedor; el local sale del selector de la barra de arriba.
// =====================================================================
(function (R) {
  const { $, esc, fmtNum, fmtPesos, fmtPesosCorto, fmtPct, fmtFecha, ICONOS, info, pref } = R.util;
  const G = R.graficos;
  const M = () => window.Medidas;

  const PERIODOS = [
    ["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "Esta semana"], ["7d", "Últimos 7 días"], ["mes", "Este mes"],
    ["mes-anterior", "Mes anterior"], ["30d", "Últimos 30 días"], ["90d", "Últimos 90 días"], ["anio", "Este año"], ["propio", "Elegir fechas…"],
  ];
  // Qué se mide en cada gráfico con selector (se recuerda en el navegador)
  const vista = Object.assign({ evolucion: "conteo", canal: "consultas", rubro: "monto", marca: "monto", nivelCat: "1", productos: "unidades" }, pref.leer("tablero-vistas", {}));
  let datos = null;       // { clave, filas, items }
  let pedido = 0;

  function filtros() {
    const periodo = $("tb-periodo").value;
    let r = periodo === "propio" ? { desde: $("tb-desde").value, hasta: $("tb-hasta").value } : M().rango(periodo, R.util.hoy());
    if (!r || !r.desde || !r.hasta) r = M().rango("mes", R.util.hoy());
    if (r.desde > r.hasta) r = { desde: r.hasta, hasta: r.desde };
    const comparar = $("tb-comparar").value;
    const comp = comparar === "no" ? null : M().comparacion(r.desde, r.hasta, comparar);
    return { ...r, comparar, comp, canal: $("tb-canal").value, vendedor: $("tb-vendedor").value, localId: R.estado.local ? R.estado.local.id : null };
  }

  function guardarFiltros() {
    pref.guardar("tablero-filtros", { periodo: $("tb-periodo").value, desde: $("tb-desde").value, hasta: $("tb-hasta").value, comparar: $("tb-comparar").value });
  }

  // Opciones de canal y vendedor según el local elegido
  function pintarOpciones() {
    const lid = R.estado.local ? R.estado.local.id : null;
    const cat = R.estado.catalogo;
    const canales = [...new Set(cat.opciones.filter(o => o.tipo === "canal" && (!lid || o.local_id === lid)).map(o => o.valor))];
    const vendedores = [...new Set(cat.vendedores.filter(v => !lid || v.local_id === lid).map(v => v.nombre))].sort((a, b) => a.localeCompare(b, "es"));
    const keep = (sel, html) => { const v = sel.value; sel.innerHTML = html; if ([...sel.options].some(o => o.value === v)) sel.value = v; };
    keep($("tb-canal"), `<option value="">Todos</option>` + canales.map(c => `<option>${esc(c)}</option>`).join(""));
    keep($("tb-vendedor"), `<option value="">Todos</option>` + vendedores.map(v => `<option>${esc(v)}</option>`).join("") + `<option value="(sin indicar)">Sin indicar</option>`);
  }

  async function cargar(f) {
    const desde = f.comp && f.comp.desde < f.desde ? f.comp.desde : f.desde;
    const clave = `${desde}|${f.hasta}|${f.localId || 0}`;
    if (datos && datos.clave === clave) return datos;
    const [filas, items] = await Promise.all([
      R.api.consultas({ desde, hasta: f.hasta, localId: f.localId }),
      R.api.items({ desde, hasta: f.hasta, localId: f.localId }),
    ]);
    datos = { clave, filas, items };
    return datos;
  }

  function delta(actual, anterior, { invertir = false, puntos = false } = {}) {
    if (anterior == null || actual == null) return "";
    if (puntos) {
      const d = (actual - anterior) * 100;
      const cls = Math.abs(d) < .05 ? "igual" : (d > 0) !== invertir ? "sube" : "baja";
      return `<span class="delta ${cls}">${d > 0 ? ICONOS.sube : d < 0 ? ICONOS.baja : ""}${d > 0 ? "+" : ""}${d.toLocaleString("es-AR", { maximumFractionDigits: 1 })} pts</span>`;
    }
    const v = M().variacion(actual, anterior);
    if (v == null) return "";
    const cls = Math.abs(v) < .005 ? "igual" : (v > 0) !== invertir ? "sube" : "baja";
    return `<span class="delta ${cls}">${v > 0 ? ICONOS.sube : v < 0 ? ICONOS.baja : ""}${v > 0 ? "+" : ""}${fmtPct(v, 0)}</span>`;
  }

  // Textos de los períodos para los globos de los indicadores (los completa dibujar())
  let periodos = { actual: "", anterior: "" };

  // Globo de un indicador: valor de este período, el de comparación, la diferencia y qué mide
  function tipKpi(etiqueta, actual, anterior, formato, { puntos = false } = {}, ayuda = "") {
    const lineas = [etiqueta, `${periodos.actual}: ${actual == null ? "sin datos" : formato(actual)}`];
    if (anterior != null) {
      lineas.push(`${periodos.anterior}: ${formato(anterior)}`);
      if (actual != null) {
        if (puntos) {
          const d = (actual - anterior) * 100;
          lineas.push(`Diferencia: ${d > 0 ? "+" : ""}${d.toLocaleString("es-AR", { maximumFractionDigits: 1 })} puntos`);
        } else {
          const v = M().variacion(actual, anterior);
          const dif = actual - anterior;
          lineas.push(`Diferencia: ${dif > 0 ? "+" : dif < 0 ? "-" : ""}${formato(Math.abs(dif))}${v == null ? "" : ` (${v > 0 ? "+" : ""}${fmtPct(v, 1)})`}`);
        }
      }
    }
    if (ayuda) lineas.push(ayuda);
    return lineas.join("\n");
  }

  function kpi(etiqueta, valor, actual, anterior, formatoAnterior, opciones = {}, ayuda = "", destacado = false) {
    const ant = anterior == null ? "" : `<span>antes ${esc(formatoAnterior(anterior))}</span>`;
    const tip = tipKpi(etiqueta, actual, anterior, formatoAnterior, opciones, ayuda);
    return `<div class="kpi${destacado ? " destacado" : ""}" data-tip="${esc(tip)}" tabindex="0"><div class="etiqueta">${esc(etiqueta)}</div>`
      + `<div class="valor${String(valor).length > 9 ? " largo" : ""}">${valor}</div><div class="detalle">${delta(actual, anterior, opciones)}${ant}</div></div>`;
  }

  function selector(id, opciones, actual) {
    return `<div class="selector" data-selector="${id}">${opciones.map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${k === actual}">${t}</button>`).join("")}</div>`;
  }

  function caja(titulo, sub, cuerpo, { ancho = false, extra = "" } = {}) {
    return `<div class="caja${ancho ? " ancho" : ""}"><div class="caja-cab"><div><h3>${esc(titulo)}</h3>${sub ? `<small>${sub}</small>` : ""}</div>${extra}</div>${cuerpo}</div>`;
  }

  async function mostrar() {
    pintarOpciones();
    $("tb-rango").hidden = $("tb-periodo").value !== "propio";
    const f = filtros();
    const n = ++pedido;
    $("tb-kpis").innerHTML = R.util.esqueleto.kpis(6);
    $("tb-graficos").innerHTML = `<div class="caja ancho">${R.util.esqueleto.grafico(230)}</div><div class="caja">${R.util.esqueleto.grafico(180)}</div><div class="caja">${R.util.esqueleto.grafico(180)}</div>`;
    $("tb-periodo-texto").textContent = "";
    let d;
    try { d = await cargar(f); }
    catch (e) { if (n === pedido) $("tb-graficos").innerHTML = `<div class="mensaje-error ancho">${esc(e.message)}</div>`; $("tb-kpis").innerHTML = ""; return; }
    if (n !== pedido) return;
    dibujar(f, d);
  }

  function dibujar(f, d) {
    const filas = M().filtrar(d.filas, f);
    const ids = new Set(filas.map(c => c.id));
    const items = d.items.filter(i => ids.has(i.consulta_id) && i.dia_venta >= f.desde && i.dia_venta <= f.hasta);
    const r = M().resumen(filas, f.desde, f.hasta);
    const a = f.comp ? M().resumen(filas, f.comp.desde, f.comp.hasta) : {};
    const dias = M().diasEntre(f.desde, f.hasta) + 1;
    const rangoCorto = (x, y) => (x === y ? fmtFecha(x) : `${R.util.fmtFechaCorta(x)} al ${R.util.fmtFechaCorta(y)}`);
    periodos = { actual: `Del ${rangoCorto(f.desde, f.hasta)}`.replace(/^Del (\d+\/\d+\/\d+)$/, "El $1"), anterior: f.comp ? `Del ${rangoCorto(f.comp.desde, f.comp.hasta)}`.replace(/^Del (\d+\/\d+\/\d+)$/, "El $1") : "" };

    $("tb-periodo-texto").textContent = (f.desde === f.hasta ? `${fmtFecha(f.desde)}` : `Del ${fmtFecha(f.desde)} al ${fmtFecha(f.hasta)} (${fmtNum(dias)} días)`)
      + (f.comp ? `, comparado con ${f.comp.desde === f.comp.hasta ? fmtFecha(f.comp.desde) : `del ${fmtFecha(f.comp.desde)} al ${fmtFecha(f.comp.hasta)}`}` : "")
      + (R.estado.local ? ` · ${R.estado.local.nombre}` : " · todos los locales");

    $("tb-kpis").innerHTML = [
      kpi("Consultas", fmtNum(r.consultas), r.consultas, a.consultas, fmtNum, {}, "Consultas por Instagram, WhatsApp u otro canal que llegaron en el período (sin anuladas)."),
      kpi("Ventas", fmtNum(r.ventas), r.ventas, a.ventas, fmtNum, {}, "Consultas que terminaron en compra, contadas por la fecha en que se concretó la venta."),
      kpi("Total vendido", fmtPesos(r.total), r.total, a.total, fmtPesos, {}, "Suma de los montos de esas ventas.", true),
      kpi("Ticket promedio", r.ticket == null ? "—" : fmtPesos(r.ticket), r.ticket, a.ticket, v => fmtPesos(v), {}, "Total vendido dividido la cantidad de ventas."),
      kpi("Conversión", r.conversion == null ? "—" : fmtPct(r.conversion), r.conversion, a.conversion, v => fmtPct(v), { puntos: true }, "De las consultas del período, cuántas terminaron en compra (aunque hayan comprado días después)."),
      kpi("Unidades vendidas", fmtNum(r.unidades), r.unidades, a.unidades, fmtNum, {}, "Suma de las cantidades de todos los artículos vendidos."),
    ].join("");

    const s = M().serie(filas, f.desde, f.hasta);
    const pasoTxt = { dia: "por día", semana: "por semana (de lunes a domingo)", mes: "por mes" }[s.paso];
    s.puntos.forEach(p => { p.titulo = s.paso === "semana" ? `Semana del ${p.etiqueta}` : s.paso === "dia" ? fmtFecha(p.clave) : p.etiqueta; });
    const evolucion = vista.evolucion === "monto"
      ? G.columnas(s.puntos, "monto", { formato: fmtPesosCorto, nombre: "Vendido", color: "var(--naranja)" })
      : G.lineas(s.puntos, [
        { clave: "consultas", nombre: "Consultas", color: "var(--rango)" },
        { clave: "ventas", nombre: "Ventas", color: "var(--naranja)" },
      ]);
    const leyenda = vista.evolucion === "monto" ? "" : `<div class="leyenda"><span style="--c:var(--rango)">Consultas</span><span style="--c:var(--naranja)">Ventas</span></div>`;

    const canales = M().porCanal(filas, f.desde, f.hasta);
    const nivelCat = Number(vista.nivelCat) || 1;
    const categorias = M().itemsPorCategoria(items, nivelCat);
    const top = M().productosTop(items, vista.productos);
    const marcas = M().itemsPor(items, "marca", "Sin marca");
    const pagos = M().ventasPor(filas, f.desde, f.hasta, "pago");
    const envios = M().ventasPor(filas, f.desde, f.hasta, "envio");
    const vendedores = M().ventasPor(filas, f.desde, f.hasta, "atendio", "Sin indicar");
    const locales = M().ventasPor(filas, f.desde, f.hasta, "local");
    const detVentas = g => `${R.util.plural(g.ventas, "venta", "ventas")}, ${R.util.plural(g.unidades, "unidad", "unidades")}`;
    const detItems = g => `${R.util.plural(g.unidades, "unidad", "unidades")} en ${R.util.plural(g.ventas, "venta", "ventas")}`;

    const html = [
      caja("Evolución", `Consultas y ventas ${pasoTxt}`, leyenda + evolucion, {
        ancho: true, extra: selector("evolucion", [["conteo", "Consultas y ventas"], ["monto", "Total vendido"]], vista.evolucion),
      }),
      caja("Cómo terminaron las consultas", `${fmtNum(r.consultas)} consultas del período`, G.embudo([
        { nombre: "Consultas", valor: r.consultas, color: "var(--rango)" },
        { nombre: "Compraron", valor: r.compraron, color: "var(--verde)" },
        { nombre: "Lo piensan", valor: r.loPiensan, color: "#d9922b" },
        { nombre: "Vencidas", valor: r.vencidas, color: "var(--alerta)" },
        { nombre: "No compraron", valor: r.noCompraron, color: "var(--tenue)" },
      ])),
      caja("Por canal", vista.canal === "monto" ? "Total vendido por canal de origen" : "Consultas por canal y su conversión",
        vista.canal === "monto"
          ? G.barras(canales, { valor: "monto", formato: fmtPesosCorto, detalle: g => R.util.plural(g.ventas, "venta", "ventas") })
          : G.barras(canales, { valor: "consultas", formato: fmtNum, color: "var(--rango)", detalle: g => `${R.util.plural(g.compraron, "compró", "compraron")} · conversión ${fmtPct(g.conversion)}` }),
        { extra: selector("canal", [["consultas", "Consultas"], ["monto", "$"]], vista.canal) }),
      caja("Categorías más vendidas", `${["", "Rubros", "Subrubros", "Categorías"][nivelCat]} de la tienda · ${vista.rubro === "monto" ? "monto vendido" : "unidades vendidas"}`,
        G.barras(categorias, { valor: vista.rubro === "monto" ? "monto" : "unidades", formato: vista.rubro === "monto" ? fmtPesosCorto : fmtNum, detalle: detItems, maximo: 12 }),
        { extra: selector("nivelCat", [["1", "Rubro"], ["2", "Subrubro"], ["3", "Categoría"]], String(nivelCat)) + selector("rubro", [["monto", "$"], ["unidades", "Unidades"]], vista.rubro) }),
      caja("Productos más vendidos", `Por nombre de producto · ${vista.productos === "monto" ? "monto vendido" : "unidades vendidas"}`,
        top.productos.length
          ? G.barras(top.productos.map(p => ({ ...p, nombre: p.nombre })), { valor: vista.productos === "monto" ? "monto" : "unidades", formato: vista.productos === "monto" ? fmtPesosCorto : fmtNum,
            detalle: g => `${g.categoria ? g.categoria + " · " : ""}${R.util.plural(g.unidades, "unidad", "unidades")} en ${R.util.plural(g.ventas, "venta", "ventas")}`, maximo: 10 })
          : `<p class="vacio">Todavía no hay ventas con producto elegido del buscador en este período.</p>`,
        { extra: selector("productos", [["unidades", "Unidades"], ["monto", "$"]], vista.productos) }),
      caja("Ventas por marca", vista.marca === "monto" ? "Monto vendido" : "Unidades vendidas",
        G.barras(marcas, { valor: vista.marca === "monto" ? "monto" : "unidades", formato: vista.marca === "monto" ? fmtPesosCorto : fmtNum, detalle: detItems, maximo: 10 }),
        { extra: selector("marca", [["monto", "$"], ["unidades", "Unidades"]], vista.marca) }),
      caja("Forma de pago", "Monto vendido con cada medio", G.barras(pagos, { valor: "monto", formato: fmtPesosCorto, detalle: detVentas })),
      caja("Envío o entrega", "Monto vendido por cómo se entregó", G.barras(envios, { valor: "monto", formato: fmtPesosCorto, detalle: detVentas })),
      caja("Por vendedor", "Monto vendido según quién atendió", G.barras(vendedores, { valor: "monto", formato: fmtPesosCorto, detalle: detVentas })),
      R.estado.local ? "" : caja("Por local", "Monto vendido en cada local", G.barras(locales, { valor: "monto", formato: fmtPesosCorto, detalle: detVentas })),
      caja("Cuándo llegan las consultas", "Cantidad de consultas por día de la semana y hora", G.calor(M().mapaCalor(filas, f.desde, f.hasta)), { ancho: true }),
    ];
    $("tb-graficos").innerHTML = html.join("");
  }

  function iniciar() {
    const guardado = pref.leer("tablero-filtros", { periodo: "mes", comparar: "periodo" });
    $("tb-periodo").innerHTML = PERIODOS.map(([k, t]) => `<option value="${k}">${t}</option>`).join("");
    $("tb-periodo").value = PERIODOS.some(p => p[0] === guardado.periodo) ? guardado.periodo : "mes";
    $("tb-comparar").value = guardado.comparar || "periodo";
    const hoy = R.util.hoy();
    $("tb-desde").value = guardado.desde || M().inicioMes(hoy);
    $("tb-hasta").value = guardado.hasta || hoy;
    ["tb-periodo", "tb-comparar", "tb-desde", "tb-hasta", "tb-canal", "tb-vendedor"].forEach(id =>
      $(id).addEventListener("change", () => { guardarFiltros(); mostrar(); }));
    $("tb-graficos").addEventListener("click", e => {
      const b = e.target.closest("[data-selector] button");
      if (!b) return;
      vista[b.closest("[data-selector]").dataset.selector] = b.dataset.v;
      pref.guardar("tablero-vistas", vista);
      if (datos) dibujar(filtros(), datos);
    });
  }

  // Se llama al guardar algo en otra pantalla: la próxima vez se vuelve a pedir a la base
  const olvidar = () => { datos = null; };

  R.vistaTablero = { iniciar, mostrar, olvidar };
})(window.CMC);
