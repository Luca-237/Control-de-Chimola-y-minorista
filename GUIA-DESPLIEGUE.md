# Despliegue en Ferozo — `minorista.bagsstore.com.ar`

La página es estática (HTML, CSS y JS): Ferozo solo sirve archivos. Todo lo dinámico (login, datos, permisos, buscador de productos y alta de usuarios) lo hace **Supabase** (ver `SUPABASE-SETUP.md`). **No hay servidor Node ni `.env`.**

Mismo circuito que rótulos, RRHH y Compras: el código va a **GitHub** y Ferozo lo descarga con **GIT → Desplegar**. No se sube nada a mano por FTP.

> **Es el hosting de producción** donde corren el catálogo, rótulos, RRHH y Compras. Este despliegue solo **agrega** un subdominio y una carpeta nueva (`public_html/minorista`), no toca nada existente. Igual conviene avisarle a Mauricio antes.

El nombre del subdominio es una propuesta: si preferís otro (por ejemplo `ventas`), cambialo en todos los pasos y en la Site URL de Supabase.

## Resumen

| # | Paso | Dónde | Tiempo |
|---|---|---|---|
| 0 | Supabase completo (migraciones y funciones) | Supabase | 15 min |
| 1 | Control, commit y push | PC + GitHub | 5 min |
| 2 | Crear el subdominio | Ferozo | 5 min |
| 3 | Certificado SSL (HTTPS) | Ferozo | 5–30 min |
| 4 | Conectar el repo y **Desplegar** | Ferozo | 10 min |
| 5 | Site URL en Supabase | Supabase | 2 min |
| 6 | Probar | Navegador | 15 min |

---

## 0. Supabase completo
Antes de publicar, en Supabase tiene que estar todo lo que la página usa (detalle en `SUPABASE-SETUP.md`):

- **Migraciones** corridas en el SQL Editor, en este orden:
  1. `20261112100000_esquema_inicial.sql` (hecha el 12/11)
  2. `20261113100000_producto_catalogo.sql` (buscador de productos)
  3. `20261113200000_cliente_lo_piensa.sql` (datos del cliente en "Lo piensa")
  4. `20261113300000_lo_piensa_un_dato.sql` (en "Lo piensa" alcanza con un dato: nombre, teléfono o usuario)
  5. `20261116100000_producto_libre_sin_rubro.sql` (un producto fuera del catálogo se guarda tal como se escribió, sin rubro)
  6. `20261116200000_anular_sin_motivo.sql` (anular una consulta sin escribir motivo)
  7. `20261117200000_cuenta_cindy.sql` (entrar con la cuenta Cindy)
  8. `20261119100000_datos_opcionales.sql` (datos del cliente opcionales también en "Lo piensa"; un producto sin elegir del buscador se guarda igual y cuenta como "Otros")

Para **arrancar en limpio** después de las pruebas: `supabase/mantenimiento/borrar-todas-las-consultas.sql` (borra todas las consultas, sus artículos y el historial; no toca usuarios, locales, listas ni empleados; es definitivo). No es una migración: se corre una sola vez, a mano.
- **Edge Functions** publicadas, las dos con **"Verify JWT" apagado**:
  - `admin-usuarios` (crear usuarios, contraseñas, habilitar).
  - `buscar-productos` (busca en Odoo), con el secreto `ODOO_API_KEY` cargado (clave de solo consulta de Odoo).
- **Authentication → Sign In / Providers:** Email prendido, "Allow new users to sign up" **apagado**.
- Tu usuario admin habilitado.

Cómo comprobar que las migraciones están (SQL Editor):
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'consultas' and column_name like 'cliente%';   -- migración 3: 2 filas
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'venta_items' and column_name = 'producto';    -- migración 2: 1 fila
```

## 1. Control, commit y push
En la carpeta del proyecto:
```bash
npm test
npm run subir-version
npm run verificar
```
- `npm test`: tienen que pasar todas.
- `npm run subir-version`: pone un `?v=` nuevo en `index.html` para que los navegadores bajen los archivos nuevos.
- `npm run verificar`: revisa que estén la URL y la clave publishable, que no haya ninguna clave secreta en lo que se publica, que el `.htaccess` bloquee lo interno y que el modo demo solo ande en la PC. Tiene que terminar con **"Listo para publicar"**.

Después, `git add`, `git commit` y `git push` a `main`. **Ferozo publica lo que está en GitHub**, no lo que hay en la PC.

### Repo público o privado
El repo `Luca-237/Control-de-Chimola-y-minorista` hoy es **público**. Se puede dejar así: no tiene datos reales (las consultas, los clientes y las ventas viven en Supabase; las pruebas usan datos inventados) ni claves secretas (`npm run verificar` lo controla). La clave publishable y la URL de Supabase están pensadas para ir en el navegador.

Si preferís que sea **privado**, la conexión del paso 4 cambia: ver 4.B.

## 2. Subdominio
Panel de Ferozo → **Dominios → Subdominios** → crear **`minorista`** en `bagsstore.com.ar`, con la carpeta **`public_html/minorista`**.
- No choca con los que ya existen: `rotulos.`, `rrhh.`, `compras.` y `stock.` son otros, y `bajas.` está reservado para el bot.
- Si el panel pide el nombre completo, es `minorista.bagsstore.com.ar`.

## 3. Certificado SSL
Ferozo → **SSL** (Let's Encrypt) → activarlo para `minorista.bagsstore.com.ar`. Puede tardar unos minutos.
- El `.htaccess` ya fuerza HTTPS. Si al abrir la página el navegador dice **"demasiados redireccionamientos"**, borrar el bloque 1 del `.htaccess` (las 4 líneas de "Forzar HTTPS") y usar la opción "Forzar HTTPS" del panel.

## 4. Conectar el repo y desplegar (Ferozo → Mi Sitio Web → GIT)

### 4.1 Dejar la carpeta vacía
Ferozo exige que la carpeta de destino esté **vacía**, y al crear el subdominio a veces pone un `cgi-bin` vacío adentro. **Administrador de archivos →** `public_html/minorista/` → si hay un `cgi-bin` vacío, borrarlo.

### 4.A Repo público (como está hoy)
Nuevo repositorio:
- **URL:** `https://github.com/Luca-237/Control-de-Chimola-y-minorista.git`
- **Rama:** `main`
- **Directorio:** `/public_html/minorista/`
- → **Desplegar**.

### 4.B Repo privado (si lo pasás a privado)
La clave SSH de Ferozo es una sola por cuenta y ya está usada en otro repo, así que va por **HTTPS con un token de GitHub de solo lectura** (igual que Compras):
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Nombre `Ferozo minorista`, vencimiento 1 año (anotá la fecha), **Only select repositories →** `Control-de-Chimola-y-minorista`, **Contents → Read-only**. Copiarlo y guardarlo en el gestor de contraseñas: **no va en el chat, en el vault ni en el código**.
2. En Ferozo → GIT, URL: `https://Luca-237:EL_TOKEN@github.com/Luca-237/Control-de-Chimola-y-minorista.git` (o usuario `Luca-237` y el token como contraseña, si el panel tiene campos aparte). Rama `main`, directorio `/public_html/minorista/` → **Desplegar**.
3. El token queda en `public_html/minorista/.git/config`; el `.htaccess` bloquea `.git` (el paso 6 lo comprueba). Cuando venza, generar otro y actualizar la URL en Ferozo.

### 4.C (Opcional) Despliegue automático en cada push
Ferozo → **GIT** → copiar la URL de **"Implementación automática"** → GitHub → el repo → **Settings → Webhooks → Add webhook** → *Payload URL* = esa URL, *Content type* `application/json`, evento **Just the push event**. Esa URL funciona como una contraseña: no compartirla. Si algún día no actualiza, botón **Desplegar** en Ferozo.

## 5. Site URL en Supabase
Supabase → **Authentication → URL Configuration → Site URL** → `https://minorista.bagsstore.com.ar` → **Save**. (El ingreso es con usuario y contraseña, sin links por mail: no hace falta agregar "Redirect URLs".)

## 6. Probar
1. Abrir `https://minorista.bagsstore.com.ar` → tiene que aparecer el login, con el candado de HTTPS.
2. Entrar con tu usuario admin → Tablero (vacío o con lo que ya se haya cargado).
3. **Usuarios y empleados → Nuevo usuario:** crear un usuario de prueba de local. Es la primera prueba real de la función `admin-usuarios`.
4. Entrar con ese usuario en otra ventana (o en el celular) y cargar: una consulta que no compró, un "Lo piensa" con nombre y contacto, y una venta buscando un producto (prueba la función `buscar-productos`). Después anularlas desde Recientes con motivo "Prueba".
5. Volver al admin: **Ver como → Operador** y **Volver a administrador**.
6. Comprobar que lo interno **no** se puede abrir. Cada uno tiene que dar **403** o **404**, nunca 200:
   ```bash
   for u in .git/config GUIA-DESPLIEGUE.md SUPABASE-SETUP.md package.json pruebas/api-falsa.js scripts/antes-de-desplegar.mjs supabase/migrations/20261112100000_esquema_inicial.sql supabase/functions/admin-usuarios/index.ts; do echo "$(curl -s -o /dev/null -w '%{http_code}' https://minorista.bagsstore.com.ar/$u)  $u"; done
   ```
   Y estos **sí** tienen que dar 200: `index.html`, `js/config.js`, `css/app.css`, `robots.txt`.
7. `https://minorista.bagsstore.com.ar/?demo=admin` **no** tiene que entrar en modo demo: solo funciona en la PC (`localhost`), y en el servidor `pruebas/` está bloqueada.

## 7. Pasarles el acceso a los locales
Para cada local (o vendedor, según se decida): **Usuarios y empleados → Nuevo usuario**, rol **Local**, marcar su local, y pasarle los datos que muestra al final (página, usuario y contraseña). En el celular conviene agregar la página a la pantalla de inicio (menú del navegador → "Agregar a pantalla de inicio").

Cargar también los **empleados de cada local** (los nombres de "Atendió") en la misma pantalla.

---

## Cada vez que se cambie algo
1. Si hay una migración nueva en `supabase/migrations/`, correrla en Supabase **antes** de publicar (SQL Editor, en orden).
2. `npm test`, `npm run subir-version` y `npm run verificar`.
3. `git commit` + `git push`.
4. Ferozo → **GIT** → **Desplegar** (no hace falta si está el webhook de 4.C).
5. En los locales, recargar la página (o cerrarla y abrirla) para que tome la versión nueva.

## Volver atrás
Si una versión publicada anda mal:
```bash
git revert HEAD
git push
```
y **Desplegar** en Ferozo. Los datos están en Supabase, así que volver atrás la página no los toca. Si el cambio incluía una migración, revisar con cuidado antes de deshacerla.

## Qué protege `.htaccess`
- Fuerza HTTPS.
- 404 para `.git/`, `supabase/`, `pruebas/`, `scripts/`, `datos-privados/` y `node_modules/`.
- Bloquea `.md`, `.json`, `.mjs`, `.ts`, `.sql`, `.csv`, `.xls`, `.xlsx`, `.pdf`, `.txt` (menos `robots.txt`) y `.gitignore`.
- Pide a los buscadores que no la indexen (`robots.txt` + `X-Robots-Tag`), no deja embeberla en otra página (`X-Frame-Options`) y no manda la dirección a otros sitios al abrir WhatsApp o Instagram (`Referrer-Policy`).

Lo que **sí** queda público, a propósito: `js/config.js`, con la URL de Supabase y la clave **publishable**. Los datos los protegen el login y los permisos de la base.

## Riesgos y cómo se cubren
| Riesgo | Cómo se cubre |
|---|---|
| Que se vean archivos internos o el historial | `.htaccess` (el paso 6 lo comprueba) |
| Que alguien sin usuario lea o cargue datos | Permisos de la base (RLS); sin sesión no hay acceso a ninguna tabla ni función |
| Que un local vea los datos del otro (incluidos nombres y teléfonos de clientes) | RLS por local; probado en `pruebas/base.test.mjs` |
| Que alguien se registre solo | Registro público apagado en Supabase; los usuarios los crea el admin |
| Publicar una clave secreta por error | `npm run verificar` frena si encuentra una |
| Romper otros sitios del hosting | Solo se agrega un subdominio y una carpeta nueva |
| Supabase pausa el proyecto tras 1 semana sin uso (plan gratis) | Con uso diario no pasa; si pasa, **Restore project** en el panel |
