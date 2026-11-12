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

## Probar la migración sin Supabase

```bash
npm install
npm test
```

Corre las migraciones en un Postgres en memoria (PGlite) y prueba las reglas y los permisos de cada rol.
