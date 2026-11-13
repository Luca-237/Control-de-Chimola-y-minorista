// =====================================================================
//  Edge Function: administración de usuarios de Control Minorista y
//  Chimola. Solo la puede usar un admin activo. Crear cuentas y cambiar
//  contraseñas necesita la clave de servicio, que vive SOLO acá
//  (Supabase la inyecta sola; nunca va en el navegador ni en el repo).
//  Basada en la de Compras.
//
//  Publicar con "Verify JWT" APAGADO: la función verifica la sesión por su cuenta.
//
//  Acciones (POST con JSON { accion, ... }):
//    listar                                   -> usuarios con su último ingreso
//    crear              { usuario, nombre, password, rol, locales: [id] }
//    activar / desactivar { id }              -> también bloquea o habilita el login
//    resetear_password  { id, password }
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "carga", "consulta"];
// "chimola" -> "chimola@minorista.cindymayorista.com.ar" (no hace falta que el email exista)
const DOMINIO_USUARIOS = "minorista.cindymayorista.com.ar";
const BLOQUEO = "876000h"; // ~100 años = cuenta desactivada

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class ErrorUsuario extends Error {
  constructor(mensaje: string, public status = 400) { super(mensaje); }
}

function exigir(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new ErrorUsuario(mensaje);
}

// Acepta un nombre de usuario ("chimola") o un email completo
function validarEmail(usuario: unknown): string {
  let e = String(usuario ?? "").trim().toLowerCase();
  if (e && !e.includes("@")) {
    exigir(/^[a-z0-9._-]{2,40}$/.test(e), "El usuario solo puede tener letras sin tilde, números, puntos y guiones");
    e = e + "@" + DOMINIO_USUARIOS;
  }
  exigir(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), "El usuario o email no es válido");
  return e;
}

function validarPassword(password: unknown): string {
  const p = String(password ?? "");
  exigir(p.length >= 8, "La contraseña tiene que tener al menos 8 caracteres");
  return p;
}

function validarRol(rol: unknown): string {
  exigir(ROLES.includes(String(rol)), "Rol inválido (admin, carga o consulta)");
  return String(rol);
}

// Traduce errores de Postgres/Auth a algo entendible
function traducir(mensaje: string): string {
  if (/último admin/i.test(mensaje)) return "No se puede quitar el último admin activo";
  if (/already been registered|already exists/i.test(mensaje)) return "Ya existe un usuario con ese nombre de usuario o email";
  if (/password/i.test(mensaje) && /weak|short|characters/i.test(mensaje)) return "La contraseña es demasiado débil";
  return mensaje;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    // Clave de servicio: la clásica (service_role) o, en proyectos nuevos, la "secret" por defecto
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
    if (!service) throw new Error("La función no tiene la clave de servicio configurada");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // 1) ¿Quién llama? (el token de la sesión del navegador)
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return respuesta({ error: "Falta iniciar sesión" }, 401);
    const { data: { user }, error: errSesion } = await admin.auth.getUser(token);
    if (errSesion || !user) return respuesta({ error: "Sesión inválida o vencida. Volvé a ingresar." }, 401);

    // 2) ¿Es admin activo?
    const { data: yo } = await admin.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
    if (!yo || yo.rol !== "admin" || !yo.activo) {
      return respuesta({ error: "Solo un admin puede administrar usuarios" }, 403);
    }

    // 3) Acción
    const body = await req.json().catch(() => ({}));
    const id = body.id ? String(body.id) : "";

    switch (body.accion) {
      case "listar": {
        const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
        return respuesta({
          ingresos: Object.fromEntries((lista?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])),
        });
      }

      case "crear": {
        const email = validarEmail(body.usuario ?? body.email);
        const password = validarPassword(body.password);
        const rol = validarRol(body.rol ?? "carga");
        const nombre = String(body.nombre ?? "").trim();
        exigir(nombre, "Falta el nombre");
        const locales = Array.isArray(body.locales) ? body.locales.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
        exigir(rol !== "carga" || locales.length, "Un usuario de local tiene que tener al menos un local");

        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { nombre },
        });
        if (error) throw error;
        const nuevo = data.user.id;
        try {
          // El trigger ya creó el perfil desactivado; le ponemos rol y lo activamos
          const { error: errPerfil } = await admin.from("perfiles").upsert({ id: nuevo, email, nombre, rol, activo: true });
          if (errPerfil) throw errPerfil;
          if (rol === "carga") {
            const { error: errLocales } = await admin.from("usuarios_locales")
              .insert(locales.map((local_id: number) => ({ usuario_id: nuevo, local_id })));
            if (errLocales) throw errLocales;
          }
        } catch (e) {
          await admin.auth.admin.deleteUser(nuevo); // no dejar usuarios a medias
          throw e;
        }
        return respuesta({ ok: true, id: nuevo, email });
      }

      case "activar":
      case "desactivar": {
        exigir(id, "Falta el usuario");
        const activo = body.accion === "activar";
        exigir(activo || id !== user.id, "No podés desactivar tu propia cuenta");
        const { error } = await admin.from("perfiles").update({ activo }).eq("id", id);
        if (error) throw error;
        // Además se bloquea el login en Auth (y se corta al renovar la sesión)
        const { error: errAuth } = await admin.auth.admin.updateUserById(id, { ban_duration: activo ? "none" : BLOQUEO });
        if (errAuth) throw errAuth;
        return respuesta({ ok: true });
      }

      case "resetear_password": {
        exigir(id, "Falta el usuario");
        const password = validarPassword(body.password);
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) throw error;
        return respuesta({ ok: true });
      }

      default:
        return respuesta({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    const status = e instanceof ErrorUsuario ? e.status : 400;
    const mensaje = traducir(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    return respuesta({ error: mensaje }, status);
  }
});
