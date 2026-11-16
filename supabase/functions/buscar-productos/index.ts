// =====================================================================
//  Edge Function: buscador de productos "mientras se escribe" (autocompletar).
//  Consulta los productos de ODOO (la base de Cindy), con o sin stock, por la
//  API JSON-2 de Odoo 19 (POST /json/2/product.template/search_read) con una
//  clave de SOLO CONSULTA guardada como secreto de la función:
//    ODOO_API_KEY   la clave (obligatoria; nunca va en el código ni en el repo)
//    ODOO_URL       opcional, por defecto https://cindymayorista.odoo.com
//  Devuelve UN resultado por nombre + categoría: si hay 12 "MOCHILA TRENDY"
//  (un código por color) en la misma categoría, sale una con su stock sumado.
//
//  POST { q: "mochila tren", limite: 8 }   (q desde 2 letras; limite 1 a 20, por defecto 8)
//  Para cualquier usuario activo (admin, carga o consulta).
//  Responde { resultados: [{ clave, nombre, categoria, ruta, categoria_id, cantidad, codigos, stock, con_stock, publicado, imagen }] }
//    clave       nombre normalizado + categoría (identifica al grupo, sirve para estadísticas)
//    categoria   categoría de Odoo (Mochilas, Billeteras, Equipajes…); ruta = la misma (Odoo la tiene plana)
//    cantidad    cuántos productos de Odoo se juntaron en ese resultado; codigos: hasta 3 códigos de ejemplo
//    stock       suma del stock disponible; con_stock = stock > 0 (se muestran igual los que no tienen)
//  Busca cada palabra en el nombre (o en el código interno), sin importar el orden: "trendy mochila" encuentra
//  "MOCHILA TRENDY". Primero los que empiezan con lo escrito. Solo productos activos y que se pueden vender.
//
//  Este archivo es independiente (no importa nada de otras funciones) para poder pegarlo tal cual en el
//  editor de Supabase.
// =====================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ODOO_URL_DEFECTO = "https://cindymayorista.odoo.com";
const POR_CONSULTA = 80;    // productos que se piden a Odoo por consulta
const LIMITE_DEFECTO = 8;
const LIMITE_MAX = 20;
const MIN_LETRAS = 2;
const MAX_LETRAS = 60;
const ESPERA_MAX_MS = 8000;
const CACHE_SEGUNDOS = 60;  // la misma búsqueda no vuelve a Odoo durante este tiempo
const CACHE_MAX = 300;
export const CAMPOS = ["id", "name", "default_code", "categ_id", "qty_available"];

// ---------- Lógica pura (se prueba sin internet) ----------
export type ProductoOdoo = {
  id: number; name?: unknown; default_code?: unknown; categ_id?: [number, string] | false | null; qty_available?: number;
};
export type Resultado = {
  clave: string; nombre: string; categoria: string; ruta: string; categoria_id: number | null;
  cantidad: number; codigos: string[]; stock: number; con_stock: boolean; publicado: boolean; imagen: string;
};

// "Mochila  NBA" y "MOCHILA NBA" son el mismo nombre; sin tildes, sin signos, sin espacios de más
export const normalizar = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Palabras a buscar (sin repetir, de 2 letras o más; como mucho 5)
export const palabras = (q: string): string[] =>
  [...new Set(String(q ?? "").replace(/[%_]/g, " ").split(/\s+/).map((p) => p.trim()).filter((p) => p.length >= 2))].slice(0, 5);

// Filtro de Odoo: solo productos activos que se venden, y cada palabra en el nombre o en el código.
// empiezaCon = true: además el nombre tiene que empezar con lo escrito (para mostrar esos primero).
export function dominio(q: string, empiezaCon = false): unknown[] {
  const d: unknown[] = [["sale_ok", "=", true]];
  for (const p of palabras(q)) d.push("|", ["name", "ilike", p], ["default_code", "ilike", p]);
  if (empiezaCon) d.push(["name", "=ilike", String(q).trim().replace(/[%_]/g, " ").replace(/\s+/g, "%") + "%"]);
  return d;
}

const categoriaDe = (p: ProductoOdoo) => (Array.isArray(p.categ_id) ? { id: p.categ_id[0], nombre: String(p.categ_id[1] || "Sin categoría") } : { id: null, nombre: "Sin categoría" });

// Junta los productos en un resultado por nombre + categoría y los ordena para el autocompletar
export function agrupar(productos: ProductoOdoo[], q: string, limite = LIMITE_DEFECTO): Resultado[] {
  const grupos = new Map<string, Resultado & { orden: number }>();
  productos.forEach((p, i) => {
    const nombre = String(p.name ?? "").replace(/\s+/g, " ").trim();
    if (!nombre) return;
    const cat = categoriaDe(p);
    const clave = normalizar(nombre) + "|" + (cat.id ?? "sin");
    const codigo = typeof p.default_code === "string" ? p.default_code.trim() : "";
    const stock = Math.max(0, Number(p.qty_available) || 0);
    const g = grupos.get(clave);
    if (g) {
      g.cantidad++;
      g.stock += stock;
      if (codigo && g.codigos.length < 3 && !g.codigos.includes(codigo)) g.codigos.push(codigo);
    } else {
      grupos.set(clave, { clave, nombre, categoria: cat.nombre, ruta: cat.nombre, categoria_id: cat.id, cantidad: 1,
        codigos: codigo ? [codigo] : [], stock, con_stock: false, publicado: true, imagen: "", orden: i });
    }
  });
  const buscado = normalizar(q);
  const empieza = (g: Resultado) => (normalizar(g.nombre).startsWith(buscado) ? 0 : 1);
  return [...grupos.values()]
    .map((g) => ({ ...g, stock: Math.round(g.stock * 100) / 100, con_stock: g.stock > 0 }))
    .sort((a, b) => empieza(a) - empieza(b) || Number(b.con_stock) - Number(a.con_stock) || a.orden - b.orden)
    .slice(0, limite)
    .map(({ orden: _o, ...r }) => r);
}

export type ConfigOdoo = { url: string; clave: string };

// Una consulta a Odoo (search_read). Los errores se explican en castellano.
export async function consultarOdoo(dom: unknown[], cfg: ConfigOdoo, pedir: typeof fetch = fetch): Promise<ProductoOdoo[]> {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), ESPERA_MAX_MS);
  try {
    const r = await pedir(cfg.url.replace(/\/+$/, "") + "/json/2/product.template/search_read", {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: "bearer " + cfg.clave, "Content-Type": "application/json", "User-Agent": "Control Minorista (buscador de productos)" },
      body: JSON.stringify({ domain: dom, fields: CAMPOS, limit: POR_CONSULTA, order: "name asc", context: { lang: "es_AR" } }),
    });
    if (r.status === 401 || r.status === 403) throw new Error("Odoo rechazó la clave (revisá el secreto ODOO_API_KEY: puede haber vencido)");
    if (!r.ok) {
      let detalle = "";
      try { const j = await r.json(); detalle = j && (j.message || j.name) ? ": " + (j.message || j.name) : ""; } catch (_e) { /* sin detalle */ }
      throw new Error("Odoo respondió " + r.status + detalle);
    }
    const lista = await r.json();
    if (!Array.isArray(lista)) throw new Error("Odoo devolvió algo inesperado");
    return lista as ProductoOdoo[];
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Odoo tardó demasiado en responder");
    throw e;
  } finally { clearTimeout(corte); }
}

// Primero los que empiezan con lo escrito; si no alcanzan, los que lo tienen en cualquier parte
export async function buscarProductos(q: string, limite: number, cfg: ConfigOdoo, pedir: typeof fetch = fetch): Promise<Resultado[]> {
  if (!palabras(q).length) return [];
  const primeros = await consultarOdoo(dominio(q, true), cfg, pedir);
  if (agrupar(primeros, q, limite).length >= limite) return agrupar(primeros, q, limite);
  const resto = await consultarOdoo(dominio(q, false), cfg, pedir);
  const vistos = new Set(primeros.map((p) => p.id));
  return agrupar([...primeros, ...resto.filter((p) => !vistos.has(p.id))], q, limite);
}

// ---------- Servidor (solo en Supabase; en la PC se importan las funciones de arriba para probarlas) ----------
const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) {
  const cache = new Map<string, { hasta: number; datos: Resultado[] }>();
  D.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);
    try {
      const { createClient } = await import("jsr:@supabase/supabase-js@2");
      const url = D.env.get("SUPABASE_URL");
      const service = D.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(D.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
      if (!service) throw new Error("La función no tiene la clave de servicio configurada");
      const clave = D.env.get("ODOO_API_KEY")?.trim();
      const odooUrl = (D.env.get("ODOO_URL")?.trim() || ODOO_URL_DEFECTO);
      if (!clave) return respuesta({ error: "Falta el secreto ODOO_API_KEY en esta función" }, 500);
      const admin = createClient(url, service, { auth: { persistSession: false } });

      // ¿Quién llama? Cualquier usuario activo
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!jwt) return respuesta({ error: "Falta iniciar sesión" }, 401);
      const { data: { user }, error: errSesion } = await admin.auth.getUser(jwt);
      if (errSesion || !user) return respuesta({ error: "Sesión inválida o vencida. Volvé a ingresar." }, 401);
      const { data: yo, error: errPerfil } = await admin.from("perfiles").select("activo").eq("id", user.id).maybeSingle();
      if (errPerfil) return respuesta({ error: "La función no pudo leer los perfiles: " + errPerfil.message }, 500);
      if (!yo || !yo.activo) return respuesta({ error: "No tenés permiso para buscar productos" }, 403);

      const body = await req.json().catch(() => ({}));
      const q = String(body.q ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LETRAS);
      const limite = Math.min(Math.max(Math.floor(Number(body.limite)) || LIMITE_DEFECTO, 1), LIMITE_MAX);
      if (q.length < MIN_LETRAS) return respuesta({ resultados: [] });

      const k = normalizar(q) + "|" + limite;
      const guardado = cache.get(k);
      if (guardado && guardado.hasta > Date.now()) return respuesta({ resultados: guardado.datos, cache: true });
      const datos = await buscarProductos(q, limite, { url: odooUrl, clave });
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(k, { hasta: Date.now() + CACHE_SEGUNDOS * 1000, datos });
      return respuesta({ resultados: datos });
    } catch (e) {
      return respuesta({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
}
