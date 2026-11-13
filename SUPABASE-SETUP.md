# Supabase: puesta en marcha

Pasos para dejar lista la base de Control Minorista y Chimola. Se hacen una sola vez.

## 1. Proyecto

- Región: **South America (São Paulo)**. No se puede cambiar después: revisar antes de crear.
- Guardar la contraseña de la base en el gestor de contraseñas. No va al vault ni al repo.
- En **Data API** dejar apagado "Automatically expose new tables": la migración da sola los permisos que hacen falta.

## 2. Login

En **Authentication → Sign In / Providers**:

- **Email**: prendido (si se apaga entero, nadie puede entrar).
- **Allow new users to sign up**: apagado. Los usuarios los crea el admin.

## 3. Migración

1. **SQL Editor → New query**.
2. Pegar todo el contenido de `supabase/migrations/20261112100000_esquema_inicial.sql` y **Run**.
3. Tiene que terminar con "Success. No rows returned".

Crea: perfiles, locales (Cindy Minorista y Chimola), usuarios por local, vendedores, listas de opciones (canal, envío, pago, rubro, marca), consultas, artículos vendidos, historial, las vistas `consultas_vista` y `venta_items_vista`, y las funciones de carga `guardar_consulta`, `cerrar_lo_piensa` y `anular_consulta`.

## 4. Primer admin

1. **Authentication → Users → Add user → Create new user**, con tu email y contraseña, tildando "Auto Confirm User".
2. En el SQL Editor (cambiar el email):

```sql
update public.perfiles set rol = 'admin', activo = true, nombre = 'Luca'
where email = 'TU-EMAIL';
```

## 5. Usuarios de los locales (para probar, hasta que exista la página de usuarios)

1. Crear el usuario en **Authentication → Users** (por ejemplo `cindyminorista@...` y `chimola@...`).
2. Activarlo y asignarle su local:

```sql
update public.perfiles set rol = 'carga', activo = true, nombre = 'Cindy Minorista'
where email = 'EMAIL-DEL-LOCAL';

insert into public.usuarios_locales (usuario_id, local_id)
select p.id, l.id from public.perfiles p, public.locales l
where p.email = 'EMAIL-DEL-LOCAL' and l.nombre = 'Cindy Minorista';
```

Mariela: `rol = 'consulta'`, `activo = true`, sin locales asignados (ve todos).

## 6. Datos para la página

En **Project Settings → API Keys** copiar la **Project URL** y la clave **publishable**. Las dos son públicas y van en `js/config.js` cuando se arme la página. La clave **secret** no va en la página ni en el repo.

## 7. Buscador de productos (migración 2 y función `buscar-productos`)

El campo "Producto" de la carga busca mientras se escribe en el catálogo de Tiendanube (un resultado por nombre y categoría) y guarda el producto y su categoría en cada artículo vendido. De ahí salen "Categorías más vendidas" y "Productos más vendidos" del tablero.

1. **SQL Editor**: pegar y correr `supabase/migrations/20261113100000_producto_catalogo.sql` (agrega columnas a `venta_items` y actualiza las funciones de carga y la vista; se puede volver a correr).
2. **Edge Functions → Deploy a new function**: nombre `buscar-productos`, contenido de `supabase/functions/buscar-productos/index.ts`. **Apagar "Verify JWT"** (la función verifica la sesión por su cuenta).
3. **Edge Functions → Secrets**: cargar `TIENDANUBE_STORE_ID` (el número de la tienda) y `TIENDANUBE_TOKEN` (la clave "a medida" de solo lectura con el permiso *Leer productos*; la pega una persona, no va en el código ni en el repo).
4. Subir a Ferozo `index.html`, `css/app.css`, `js/` completo (hay archivos nuevos: `js/buscador-producto.js`) y recargar con Ctrl+F5.

Si la función no está publicada o falla, el campo avisa y deja elegir "Otro producto": la venta se carga igual con el rubro de la lista, como antes.

## 8. Datos del cliente en "Lo piensa" (migración 3)

Una consulta que queda en "Lo piensa" tiene que llevar el nombre y apellido del cliente y su teléfono (WhatsApp) o usuario (Instagram), para poder seguirla. La base lo exige; en las demás consultas es opcional. En "Lo piensan" cada tarjeta muestra el contacto con un botón para escribirle por WhatsApp o abrir su Instagram.

1. **SQL Editor**: pegar y correr `supabase/migrations/20261113200000_cliente_lo_piensa.sql` **después** de la migración 2 (agrega dos columnas a `consultas`, actualiza `guardar_consulta` y la vista `consultas_vista`; se puede volver a correr).
2. Subir a Ferozo `index.html`, `css/app.css` y `js/` y recargar con Ctrl+F5.

Hasta correr esta migración, cargar un "Lo piensa" desde la página nueva da error (la base todavía no tiene las columnas).

## 9. Crear usuarios desde la página (función `admin-usuarios`)

En **Usuarios y empleados** el admin crea usuarios (nombre, usuario, contraseña, rol y locales), los habilita o deshabilita y les cambia la contraseña. Para eso hace falta la clave de servicio, que vive solo en la función de Supabase (nunca en la página).

1. **Edge Functions → Deploy a new function**: nombre `admin-usuarios`, contenido de `supabase/functions/admin-usuarios/index.ts`. **Apagar "Verify JWT"** (la función verifica la sesión y que sea un admin activo por su cuenta).
2. No necesita secretos: Supabase le pasa sola la clave de servicio.
3. Subir a Ferozo `index.html`, `css/app.css` y `js/`.

Los usuarios se crean como `usuario@minorista.cindymayorista.com.ar` (se entra escribiendo solo `usuario`). Un usuario de local tiene que tener al menos un local. Deshabilitar también bloquea el login en Supabase. Sin la función publicada, la tabla de usuarios se sigue viendo y se pueden cambiar rol, nombre y locales, pero crear, habilitar y cambiar contraseñas avisa que falta la función.

**Empleados de cada local:** en la misma pantalla se cargan los nombres que aparecen en "Atendió" (no necesitan usuario). Se pasaron ahí desde Configuración.

## Historial rápido de ventas (pantalla Cargar)

A la derecha del formulario de carga, en pantallas anchas (desde unos 1180 px), queda fijo el panel **Últimas ventas** del local elegido: las ventas de los últimos 7 días por fecha de venta (incluye las que se cerraron desde "Lo piensan"), agrupadas por día con su total, y hasta 25 ventas con hora, monto, artículos, forma de pago, envío y quién atendió. Una venta recién cargada aparece arriba resaltada. **Corregir** abre el mismo diálogo de Recientes (el admin siempre; el local, durante las horas que tenga configuradas). En pantallas angostas el panel pasa debajo del formulario. No requiere migración.

## Ver la página como otro rol (solo admin)

Arriba, al lado del selector de local, el admin tiene **Ver como**: *Operador (prueba)* muestra la página tal cual la ve el personal del local (solo Cargar, Lo piensan, Recientes y Configuración) y *Consulta (prueba)* lo que ve Mariela. Un aviso amarillo recuerda que se está probando: **lo que se cargue, corrija, cierre o anule en ese modo no se guarda** (los avisos lo aclaran) y se puede recorrer todo el flujo sin ensuciar los datos. "Volver a administrador" (o elegir Administrador) vuelve a la vista normal. Al recargar la página siempre se vuelve a la vista de admin.

## Probar la migración sin Supabase

```bash
npm install
npm test
```

Corre las migraciones en un Postgres en memoria (PGlite) y prueba las reglas y los permisos de cada rol.

## Probar la página sin base (modo demo)

En la PC, con un servidor local (por ejemplo `npx http-server` en esta carpeta), abrir:

- `http://localhost:PUERTO/?demo=admin`: tablero, planilla, configuración y usuarios.
- `http://localhost:PUERTO/?demo=carga`: la pantalla simple del local (Cindy Minorista).
  (En el modo demo el buscador usa un catálogo de ejemplo de 24 productos.)
- `http://localhost:PUERTO/?demo=consulta`: lo que ve Mariela.

Usa `pruebas/api-falsa.js` con unos meses de consultas inventadas. No toca Supabase y solo funciona en `localhost`.
