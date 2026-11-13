window.CMC = window.CMC || {};

(function (R) {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

  // Usuario <-> email de login. "chimola" -> "chimola@minorista.cindymayorista.com.ar"
  const dominioUsuarios = () => ((window.CMC_CONFIG || {}).dominioUsuarios || "minorista.local").toLowerCase();
  const aEmail = u => {
    const s = String(u || "").trim().toLowerCase();
    return s.includes("@") ? s : `${s}@${dominioUsuarios()}`;
  };
  const aUsuario = email => {
    const s = String(email || "").toLowerCase(), sufijo = "@" + dominioUsuarios();
    return s.endsWith(sufijo) ? s.slice(0, -sufijo.length) : s;
  };

  // ---------- Fechas y números (hora de Argentina) ----------
  const ZONA = "America/Argentina/Cordoba";
  const iso = d => d.toLocaleDateString("en-CA", { timeZone: ZONA }); // YYYY-MM-DD
  const hoy = () => iso(new Date());
  const fmtFecha = s => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—";
  const fmtFechaCorta = s => s ? String(s).slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "—";
  const fmtHora = t => t ? new Date(t).toLocaleTimeString("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" }) : "";
  const fechaHora = t => t ? new Date(t).toLocaleString("es-AR", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtNum = (n, dec = 0) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  const fmtPesos = (n, dec = 0) => n == null ? "—" : "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  // $ 1,2 M / $ 850 mil: para ejes y barras
  const fmtPesosCorto = n => {
    const v = Number(n || 0), a = Math.abs(v);
    if (a >= 1e6) return "$ " + (v / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
    if (a >= 1e4) return "$ " + Math.round(v / 1e3).toLocaleString("es-AR") + " mil";
    return fmtPesos(v);
  };
  const fmtPct = (n, dec = 1) => n == null ? "—" : (n * 100).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec }) + " %";
  const plural = (n, uno, varios) => `${fmtNum(n)} ${n === 1 ? uno : varios}`;
  // "hace 3 días", "hoy", "ayer"
  function hace(t) {
    const dias = Math.round((Date.parse(hoy()) - Date.parse(iso(new Date(t)))) / 86400000);
    if (dias <= 0) return "hoy, " + fmtHora(t);
    if (dias === 1) return "ayer, " + fmtHora(t);
    return `hace ${dias} días`;
  }
  // Para <input type="datetime-local"> en hora argentina
  const aInputFechaHora = t => {
    const d = new Date(t || Date.now());
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  // Lo que se escribió en datetime-local, en hora argentina (UTC-3, sin horario de verano)
  const deInputFechaHora = v => v ? new Date(v + ":00-03:00").toISOString() : null;
  // Monto escrito a mano: "49.900", "49900,50", "$ 1.200" -> número
  function leerMonto(v) {
    let s = String(v ?? "").replace(/[^\d.,-]/g, "");
    if (!s) return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  let timerToast;
  function toast(mensaje, tipo = "ok", ms = 3500, accion) {
    const el = $("toast");
    if (accion) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "toast-accion"; b.textContent = accion.texto;
      b.addEventListener("click", () => { el.hidden = true; accion.fn(); });
      el.replaceChildren(document.createTextNode(mensaje), b);
    } else el.textContent = mensaje;
    el.classList.toggle("error", tipo === "error");
    el.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(() => { el.hidden = true; }, ms);
  }

  // CSV para Excel en español: separador ";" y BOM para que respete las tildes
  function descargarCSV(nombreArchivo, filas) {
    const celda = v => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const texto = "﻿" + filas.map(f => f.map(celda).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
    a.download = nombreArchivo;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function iniciarDialogos() {
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-cerrar]");
      if (b) b.closest("dialog").close();
    });
  }

  // Confirmación con un diálogo propio (no el confirm() del navegador). Devuelve el texto escrito o null.
  function pedir({ titulo, texto, campo, boton = "Aceptar", peligro = false }) {
    return new Promise(resolver => {
      const d = $("dlg-pedir");
      $("pedir-titulo").textContent = titulo;
      $("pedir-texto").textContent = texto || "";
      const input = $("pedir-campo");
      $("pedir-campo-wrap").hidden = !campo;
      $("pedir-campo-label").textContent = campo || "";
      input.value = "";
      const ok = $("pedir-ok");
      ok.textContent = boton;
      ok.classList.toggle("peligro", peligro);
      let respuesta = null;
      const aceptar = e => {
        e.preventDefault();
        if (campo && !input.value.trim()) { input.focus(); return; }
        respuesta = campo ? input.value.trim() : "";
        d.close();
      };
      $("form-pedir").onsubmit = aceptar;
      d.onclose = () => resolver(respuesta);
      d.showModal();
      (campo ? input : ok).focus();
    });
  }

  // Íconos de interfaz (Lucide, SVG en línea; nunca emojis)
  const svg = cuerpo => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;
  const ICONOS = {
    whatsapp: svg(`<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>`),
    instagram: svg(`<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>`),
    canal: svg(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`),
    compro: svg(`<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>`),
    loPiensa: svg(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
    noCompro: svg(`<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>`),
    mas: svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`),
    basura: svg(`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`),
    sube: svg(`<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`),
    baja: svg(`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`),
    descarga: svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`),
  };
  const iconoCanal = nombre => /whats/i.test(nombre) ? ICONOS.whatsapp : /insta/i.test(nombre) ? ICONOS.instagram : ICONOS.canal;

  // Estado de una consulta (estado_efectivo de la vista)
  const ESTADOS = { compro: "Compró", lo_piensa: "Lo piensa", no_compro: "No compró", vencida: "Vencida", anulada: "Anulada" };
  const chipEstado = e => `<span class="estado ${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;

  // ---------- Ayudas "i" y globos de los gráficos ----------
  const info = texto => `<span class="info" tabindex="0" role="img" aria-label="${esc(texto)}" data-info="${esc(texto)}"></span>`;

  function iniciarAyudas() {
    const globo = document.createElement("div");
    globo.className = "globo-info";
    globo.setAttribute("role", "tooltip");
    globo.hidden = true;
    let actual = null, cuadro = 0, ultimo = null, ocultando = 0;
    // Los "i" y lo que tenga data-tip. Si un elemento con data-tip está dentro de otro (ej. el "i" dentro de un
    // indicador), gana el de adentro.
    const SEL = ".info[data-info], [data-tip]";

    // El texto puede tener varias líneas ("\n"): la primera va como título
    function pintarTexto(el) {
      const lineas = String(el.dataset.info || el.dataset.tip || "").split("\n").filter(Boolean);
      globo.classList.toggle("con-titulo", lineas.length > 1);
      globo.innerHTML = lineas.length > 1
        ? `<strong>${esc(lineas[0])}</strong>` + lineas.slice(1).map(l => `<span>${esc(l)}</span>`).join("")
        : esc(lineas[0] || "");
    }
    // Ubica el globo arriba del puntero (o del elemento), sin salirse de la pantalla; si no entra arriba, va abajo
    function colocar(x, y) {
      const el = actual;
      if (!el) return;
      const r = el.getBoundingClientRect(), g = globo.getBoundingClientRect(), m = 8;
      const sigue = x != null;   // los gráficos siguen al puntero; los "i" quedan fijos sobre el ícono
      const cx = sigue ? x : r.left + r.width / 2, arriba = sigue ? y - 14 : r.top - 8, abajo = sigue ? y + 22 : r.bottom + 8;
      const left = Math.max(m, Math.min(cx - g.width / 2, window.innerWidth - g.width - m));
      let top = arriba - g.height;
      if (top < m) top = Math.min(abajo, window.innerHeight - g.height - m);
      globo.style.left = `${Math.round(left)}px`;
      globo.style.top = `${Math.round(top)}px`;
    }
    function mostrar(el, x, y) {
      clearTimeout(ocultando);
      const destino = el.closest("dialog[open]") || document.body;
      // Se mueve al lugar correcto una sola vez: volver a insertarlo reinicia la animación y parpadea
      if (globo.parentElement !== destino) destino.appendChild(globo);
      if (el !== actual) { actual = el; pintarTexto(el); }
      globo.hidden = false;
      colocar(x, y);
    }
    function ocultar(demora = 0) {
      clearTimeout(ocultando);
      const fin = () => { actual = null; globo.hidden = true; };
      if (demora) ocultando = setTimeout(fin, demora); else fin();
    }
    const tipDe = t => (t && t.closest ? t.closest(SEL) : null);

    document.addEventListener("mouseover", e => {
      const el = tipDe(e.target);
      if (el && el === actual) clearTimeout(ocultando);   // volvió enseguida al mismo: no se apaga
      else if (el) mostrar(el, el.dataset.tip ? e.clientX : undefined, el.dataset.tip ? e.clientY : undefined);
    });
    // Mover el mouse solo reubica (una vez por cuadro de pantalla)
    document.addEventListener("mousemove", e => {
      if (!actual || !actual.dataset.tip) return;
      ultimo = e;
      if (!cuadro) cuadro = requestAnimationFrame(() => { cuadro = 0; if (actual && ultimo) colocar(ultimo.clientX, ultimo.clientY); });
    });
    // Al pasar de una barra a la de al lado (o por el hueco entre las dos) no se apaga y se vuelve a prender
    document.addEventListener("mouseout", e => {
      const el = tipDe(e.target);
      if (!el || el !== actual || el.contains(e.relatedTarget)) return;
      if (tipDe(e.relatedTarget)) return;   // el mouseover del nuevo lo cambia
      ocultar(120);
    });
    // En el celular: tocar muestra el globo; tocar fuera lo cierra
    document.addEventListener("touchstart", e => {
      const el = e.target.closest("[data-tip], .info[data-info]");
      if (el) { const t = e.touches[0]; mostrar(el, el.dataset.tip ? t.clientX : undefined, el.dataset.tip ? t.clientY : undefined); }
      else if (actual) ocultar();
    }, { passive: true });
    document.addEventListener("focusin", e => { if (e.target.matches(".info[data-info]:focus-visible, [data-tip]:focus-visible")) mostrar(e.target); });
    document.addEventListener("focusout", e => { if (e.target === actual) ocultar(); });
    document.addEventListener("scroll", () => { if (actual) ocultar(); }, true);
    window.addEventListener("blur", () => { if (actual) ocultar(); });
  }

  // ---------- Tema: automático → claro → oscuro ----------
  // Predeterminado: claro (no sigue al sistema). El botón alterna claro <-> oscuro y se recuerda en este navegador.
  // El ícono muestra el tema al que se pasa (luna en claro, sol en oscuro).
  const TEMAS = {
    oscuro: { siguiente: "claro", texto: "oscuro", icono: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`) },
    claro: { siguiente: "oscuro", texto: "claro", icono: svg(`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`) },
  };
  const temaActual = () => (document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro");
  function pintarBotonesTema() {
    const t = TEMAS[temaActual()];
    document.querySelectorAll("[data-tema-boton]").forEach(b => {
      b.innerHTML = t.icono;
      const texto = `Cambiar a tema ${TEMAS[t.siguiente].texto}`;
      b.title = texto;
      b.setAttribute("aria-label", texto);
    });
  }
  function iniciarTema() {
    pintarBotonesTema();
    document.addEventListener("click", e => {
      if (!e.target.closest("[data-tema-boton]")) return;
      const nuevo = TEMAS[temaActual()].siguiente;
      document.documentElement.dataset.tema = nuevo;
      try { if (nuevo === "claro") localStorage.removeItem("cmc-tema"); else localStorage.setItem("cmc-tema", nuevo); } catch (err) {}
      pintarBotonesTema();
      document.dispatchEvent(new CustomEvent("cmc-tema"));
    });
  }

  // Preferencias de esta persona en este navegador (local elegido, vendedor, filtros)
  const pref = {
    leer(clave, defecto) { try { const v = localStorage.getItem("cmc-" + clave); return v == null ? defecto : JSON.parse(v); } catch (e) { return defecto; } },
    guardar(clave, valor) { try { localStorage.setItem("cmc-" + clave, JSON.stringify(valor)); } catch (e) {} },
  };

  // ---------- Esqueletos de carga ----------
  const ANCHOS = [72, 48, 86, 60, 40, 78, 54, 66, 90, 45];
  const barra = (ancho, alto = 12, extra = "") => `<span class="esq" style="width:${ancho}${typeof ancho === "number" ? "%" : ""}; height:${alto}px${extra}"></span>`;
  const aviso = `<span class="sr-only">Cargando…</span>`;
  const esqueleto = {
    kpis(n = 4) {
      return aviso + Array.from({ length: n }, (_, i) => `<div class="kpi" aria-hidden="true">${barra(55 + (i % 3) * 10, 10)}${barra(38, 28, "; margin-top:12px")}${barra(70 - (i % 2) * 15, 10, "; margin-top:10px")}</div>`).join("");
    },
    filas(cols, n = 6) {
      return Array.from({ length: n }, (_, f) => `<tr class="esq-fila" aria-hidden="true">${Array.from({ length: cols }, (_, c) =>
        `<td>${barra(ANCHOS[(f + c) % 10] - 10, 12)}</td>`).join("")}</tr>`).join("");
    },
    tarjetas(n = 3) {
      return aviso + Array.from({ length: n }, (_, i) => `<div class="tarjeta-consulta" aria-hidden="true">${barra(50 + (i % 3) * 10, 14)}${barra(80, 10)}${barra(36, 34, "; border-radius:8px")}</div>`).join("");
    },
    grafico(alto = 180) { return `<span class="esq" style="width:100%; height:${alto}px; border-radius:10px"></span>`; },
  };

  R.util = {
    $, esc, norm, aEmail, aUsuario, ZONA, iso, hoy, fmtFecha, fmtFechaCorta, fmtHora, fechaHora, fmtNum, fmtPesos, fmtPesosCorto, fmtPct,
    plural, hace, aInputFechaHora, deInputFechaHora, leerMonto, toast, descargarCSV, iniciarDialogos, pedir, svg, ICONOS, iconoCanal,
    ESTADOS, chipEstado, info, iniciarAyudas, iniciarTema, pref, esqueleto,
  };
})(window.CMC);
