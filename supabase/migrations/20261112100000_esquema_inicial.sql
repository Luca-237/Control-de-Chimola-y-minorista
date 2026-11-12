-- =====================================================================
--  Control Minorista y Chimola: consultas y ventas de los locales.
--  Esquema inicial. Se corre UNA vez en Supabase -> SQL Editor.
--
--  Qué resuelve: cada local (Cindy Minorista, Chimola) registra las
--  consultas que llegan por Instagram y WhatsApp y, si terminan en
--  venta, qué se vendió, cómo se envió y cómo se cobró.
--
--  Roles:
--    admin     -> todo: usuarios, locales, listas, corregir y anular siempre.
--    carga     -> carga y corrige en sus locales (usuario del local).
--    consulta  -> solo mira, todos los locales (Mariela).
--  Los permisos los controla la base (RLS), no la página.
--
--  Las consultas solo se escriben con las funciones guardar_consulta,
--  cerrar_lo_piensa y anular_consulta: así las reglas (venta completa,
--  plazos, local correcto) no se pueden saltear desde el navegador.
--
--  Fechas: se guardan con zona horaria. "Lo piensa" vencido no se guarda
--  como estado: lo calcula la vista consultas_vista según los días del local.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Perfiles de usuario (uno por cuenta de Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text not null default '',
  rol        text not null default 'consulta' check (rol in ('admin', 'carga', 'consulta')),
  -- Las cuentas nacen desactivadas: si alguien se registra por su cuenta, no entra.
  activo     boolean not null default false,
  creado_en  timestamptz not null default now()
);

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin' and activo);
$$;

create or replace function public.es_usuario_activo()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo);
$$;

create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre, activo)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nombre', ''), false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- Usuarios que ya existieran antes de correr este script
insert into public.perfiles (id, email, nombre)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'nombre', '')
from auth.users u
on conflict (id) do nothing;

-- Nunca puede quedar el sistema sin un admin activo
create or replace function public.proteger_ultimo_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.rol = 'admin' and old.activo
     and (tg_op = 'DELETE' or new.rol <> 'admin' or not new.activo)
     and not exists (select 1 from public.perfiles
                     where rol = 'admin' and activo and id <> old.id) then
    raise exception 'No se puede quitar el último admin activo';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists proteger_admin on public.perfiles;
create trigger proteger_admin
  before update or delete on public.perfiles
  for each row execute function public.proteger_ultimo_admin();

-- Marca de última modificación (quién y cuándo)
create or replace function public.marcar_actualizacion()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$$;

-- Fecha de hoy en Argentina (Supabase corre en UTC)
create or replace function public.hoy()
returns date
language sql stable set search_path = public
as $$
  select (now() at time zone 'America/Argentina/Cordoba')::date;
$$;

-- ---------------------------------------------------------------------
-- 2) Locales y qué usuarios trabajan en cada uno
-- ---------------------------------------------------------------------
create table if not exists public.locales (
  id                   smallint generated always as identity primary key,
  nombre               text not null unique check (length(trim(nombre)) > 0),
  color                text not null default '#444444' check (color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url             text not null default '',
  -- Un "Lo piensa" sin respuesta pasa a vencido (cuenta como no compró) a los N días
  dias_lo_piensa       smallint not null default 15 check (dias_lo_piensa between 1 and 90),
  -- El usuario del local puede corregir o anular lo que cargó durante N horas
  horas_edicion        smallint not null default 48 check (horas_edicion between 0 and 720),
  -- Hasta cuántos días hacia atrás puede cargar una consulta atrasada
  dias_carga_atrasada  smallint not null default 7 check (dias_carga_atrasada between 0 and 60),
  activo               boolean not null default true,
  creado_en            timestamptz not null default now()
);

create table if not exists public.usuarios_locales (
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  local_id    smallint not null references public.locales(id) on delete cascade,
  primary key (usuario_id, local_id)
);

-- Admin y consulta ven todos los locales; carga, solo los suyos.
create or replace function public.puede_ver_local(p_local smallint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.activo
      and (p.rol in ('admin', 'consulta')
           or exists (select 1 from public.usuarios_locales ul
                      where ul.usuario_id = p.id and ul.local_id = p_local)));
$$;

create or replace function public.puede_cargar_local(p_local smallint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.activo
      and (p.rol = 'admin'
           or (p.rol = 'carga'
               and exists (select 1 from public.usuarios_locales ul
                           where ul.usuario_id = p.id and ul.local_id = p_local))));
$$;

-- ---------------------------------------------------------------------
-- 3) Vendedores ("Atendió") y listas de opciones, propias de cada local.
--    No se borran: se desactivan, para no romper lo ya cargado.
-- ---------------------------------------------------------------------
create table if not exists public.vendedores (
  id         integer generated always as identity primary key,
  local_id   smallint not null references public.locales(id),
  nombre     text not null check (length(trim(nombre)) > 0),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create unique index if not exists vendedores_unico on public.vendedores (local_id, lower(trim(nombre)));

create table if not exists public.opciones (
  id         integer generated always as identity primary key,
  local_id   smallint not null references public.locales(id),
  tipo       text not null check (tipo in ('canal', 'envio', 'pago', 'rubro', 'marca')),
  valor      text not null check (length(trim(valor)) > 0),
  orden      smallint not null default 0,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create unique index if not exists opciones_unico on public.opciones (local_id, tipo, lower(trim(valor)));

-- ---------------------------------------------------------------------
-- 4) Consultas (una fila por consulta) y artículos vendidos
-- ---------------------------------------------------------------------
create table if not exists public.consultas (
  id               bigint generated always as identity primary key,
  local_id         smallint not null references public.locales(id),
  fecha_consulta   timestamptz not null default now(),
  canal_id         integer not null references public.opciones(id),
  estado           text not null check (estado in ('no_compro', 'lo_piensa', 'compro')),
  atendio_id       integer references public.vendedores(id),
  -- Solo si compró. La venta se cuenta por esta fecha, no por la de la consulta.
  fecha_venta      timestamptz,
  envio_id         integer references public.opciones(id),
  pago_id          integer references public.opciones(id),
  monto_total      numeric(14, 2) not null default 0 check (monto_total >= 0),  -- suma de los artículos (trigger)
  nota             text not null default '',
  origen           text not null default 'carga' check (origen in ('carga', 'importacion')),
  cerrada_en       timestamptz,  -- cuando un "Lo piensa" pasó a compró o no compró
  anulada          boolean not null default false,
  anulada_motivo   text not null default '',
  anulada_por      uuid,
  anulada_en       timestamptz,
  creado_por       uuid default auth.uid(),
  creado_en        timestamptz not null default now(),
  actualizado_por  uuid,
  actualizado_en   timestamptz,
  -- Una venta tiene fecha, envío y pago (lo importado de la planilla vieja puede no tenerlos).
  -- Si no compró, no lleva datos de venta.
  constraint venta_completa check (
    (estado = 'compro' and fecha_venta is not null
       and (origen = 'importacion' or (envio_id is not null and pago_id is not null)))
    or (estado <> 'compro' and fecha_venta is null and envio_id is null and pago_id is null)),
  constraint venta_despues_de_consulta check (fecha_venta is null or fecha_venta >= fecha_consulta - interval '1 minute'),
  constraint anulacion_con_motivo check (not anulada or length(trim(anulada_motivo)) > 0)
);
create index if not exists consultas_local_fecha on public.consultas (local_id, fecha_consulta);
create index if not exists consultas_local_venta on public.consultas (local_id, fecha_venta) where estado = 'compro';
create index if not exists consultas_abiertas on public.consultas (local_id, fecha_consulta) where estado = 'lo_piensa' and not anulada;

create table if not exists public.venta_items (
  id           bigint generated always as identity primary key,
  consulta_id  bigint not null references public.consultas(id) on delete cascade,
  rubro_id     integer references public.opciones(id),   -- obligatorio al cargar; puede faltar en lo importado
  marca_id     integer references public.opciones(id),
  descripcion  text not null default '',
  cantidad     integer not null check (cantidad > 0),
  monto        numeric(14, 2) not null check (monto >= 0)  -- total del renglón, lo que pagó el cliente
);
create index if not exists venta_items_consulta on public.venta_items (consulta_id);

drop trigger if exists consultas_actualizacion on public.consultas;
create trigger consultas_actualizacion
  before update on public.consultas
  for each row execute function public.marcar_actualizacion();

-- Las opciones y el vendedor tienen que ser del mismo local y del tipo correcto
create or replace function public.opcion_valida(p_opcion integer, p_local smallint, p_tipo text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_opcion is null
      or exists (select 1 from public.opciones where id = p_opcion and local_id = p_local and tipo = p_tipo);
$$;

create or replace function public.controlar_consulta()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.local_id <> old.local_id then
    raise exception 'Una consulta no se puede pasar a otro local';
  end if;
  if not public.opcion_valida(new.canal_id, new.local_id, 'canal') then
    raise exception 'El canal no corresponde a este local';
  end if;
  if not public.opcion_valida(new.envio_id, new.local_id, 'envio') then
    raise exception 'El método de envío no corresponde a este local';
  end if;
  if not public.opcion_valida(new.pago_id, new.local_id, 'pago') then
    raise exception 'La forma de pago no corresponde a este local';
  end if;
  if new.atendio_id is not null
     and not exists (select 1 from public.vendedores where id = new.atendio_id and local_id = new.local_id) then
    raise exception 'El vendedor no corresponde a este local';
  end if;
  return new;
end;
$$;

drop trigger if exists controlar_consulta on public.consultas;
create trigger controlar_consulta
  before insert or update on public.consultas
  for each row execute function public.controlar_consulta();

create or replace function public.controlar_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_local smallint;
begin
  select local_id into v_local from public.consultas where id = new.consulta_id;
  if not public.opcion_valida(new.rubro_id, v_local, 'rubro') then
    raise exception 'El rubro no corresponde a este local';
  end if;
  if not public.opcion_valida(new.marca_id, v_local, 'marca') then
    raise exception 'La marca no corresponde a este local';
  end if;
  return new;
end;
$$;

drop trigger if exists controlar_item on public.venta_items;
create trigger controlar_item
  before insert or update on public.venta_items
  for each row execute function public.controlar_item();

-- monto_total = suma de los artículos
create or replace function public.recalcular_monto()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint := coalesce(new.consulta_id, old.consulta_id);
begin
  update public.consultas c
     set monto_total = coalesce((select sum(monto) from public.venta_items where consulta_id = v_id), 0)
   where c.id = v_id
     and c.monto_total is distinct from coalesce((select sum(monto) from public.venta_items where consulta_id = v_id), 0);
  return null;
end;
$$;

drop trigger if exists recalcular_monto on public.venta_items;
create trigger recalcular_monto
  after insert or update or delete on public.venta_items
  for each row execute function public.recalcular_monto();

-- ---------------------------------------------------------------------
-- 5) Historial: el antes y el después de cada cambio
-- ---------------------------------------------------------------------
create table if not exists public.historial (
  id           bigint generated always as identity primary key,
  tabla        text not null,
  registro_id  bigint not null,
  accion       text not null,
  antes        jsonb,
  despues      jsonb,
  usuario      uuid default auth.uid(),
  fecha        timestamptz not null default now()
);
create index if not exists historial_registro on public.historial (tabla, registro_id);

create or replace function public.registrar_historial()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.historial (tabla, registro_id, accion, antes, despues)
  values (tg_table_name,
          coalesce(new.id, old.id),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end;
$$;

drop trigger if exists historial_consultas on public.consultas;
create trigger historial_consultas
  after insert or update or delete on public.consultas
  for each row execute function public.registrar_historial();

drop trigger if exists historial_items on public.venta_items;
create trigger historial_items
  after insert or update or delete on public.venta_items
  for each row execute function public.registrar_historial();

-- ---------------------------------------------------------------------
-- 6) Vista para la página y el tablero (respeta los permisos de quien consulta)
-- ---------------------------------------------------------------------
create or replace view public.consultas_vista with (security_invoker = true) as
select
  c.id,
  c.local_id,
  l.nombre                       as local,
  c.fecha_consulta,
  (c.fecha_consulta at time zone 'America/Argentina/Cordoba')::date as dia_consulta,
  c.canal_id,
  ca.valor                       as canal,
  c.estado,
  case when c.estado = 'lo_piensa'
        and c.fecha_consulta < now() - make_interval(days => l.dias_lo_piensa::int)
       then 'vencida' else c.estado end as estado_efectivo,
  c.atendio_id,
  v.nombre                       as atendio,
  c.fecha_venta,
  (c.fecha_venta at time zone 'America/Argentina/Cordoba')::date as dia_venta,
  c.envio_id,
  en.valor                       as envio,
  c.pago_id,
  pa.valor                       as pago,
  c.monto_total,
  coalesce((select sum(i.cantidad) from public.venta_items i where i.consulta_id = c.id), 0) as unidades,
  c.nota,
  c.origen,
  c.cerrada_en,
  c.anulada,
  c.anulada_motivo,
  c.creado_por,
  c.creado_en,
  -- Si el usuario del local todavía la puede corregir (el admin siempre puede)
  (c.creado_en >= now() - make_interval(hours => l.horas_edicion::int)) as editable_por_local
from public.consultas c
join public.locales l       on l.id = c.local_id
join public.opciones ca     on ca.id = c.canal_id
left join public.vendedores v on v.id = c.atendio_id
left join public.opciones en  on en.id = c.envio_id
left join public.opciones pa  on pa.id = c.pago_id;

create or replace view public.venta_items_vista with (security_invoker = true) as
select
  i.id,
  i.consulta_id,
  c.local_id,
  c.fecha_venta,
  (c.fecha_venta at time zone 'America/Argentina/Cordoba')::date as dia_venta,
  i.rubro_id,
  r.valor  as rubro,
  i.marca_id,
  m.valor  as marca,
  i.descripcion,
  i.cantidad,
  i.monto
from public.venta_items i
join public.consultas c    on c.id = i.consulta_id
left join public.opciones r on r.id = i.rubro_id
left join public.opciones m on m.id = i.marca_id
where not c.anulada;

-- ---------------------------------------------------------------------
-- 7) Funciones de carga (la única forma de escribir consultas)
-- ---------------------------------------------------------------------

-- Controla los artículos que manda la página. Interna: no se llama desde afuera.
create or replace function public.validar_items(p_items jsonb)
returns void
language plpgsql immutable set search_path = public
as $$
declare
  it jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Una venta necesita al menos un artículo';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(it ->> 'rubro_id', '') is null then
      raise exception 'Falta el rubro de un artículo';
    end if;
    if coalesce(nullif(it ->> 'cantidad', '')::numeric, 0) <= 0
       or nullif(it ->> 'cantidad', '')::numeric <> trunc(nullif(it ->> 'cantidad', '')::numeric) then
      raise exception 'La cantidad tiene que ser un número entero mayor a cero';
    end if;
    if nullif(it ->> 'monto', '') is null or (it ->> 'monto')::numeric < 0 then
      raise exception 'Falta el monto de un artículo o es negativo';
    end if;
  end loop;
end;
$$;

-- Reemplaza los artículos de una consulta. Interna.
create or replace function public.reemplazar_items(p_consulta bigint, p_items jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.venta_items where consulta_id = p_consulta;
  insert into public.venta_items (consulta_id, rubro_id, marca_id, descripcion, cantidad, monto)
  select p_consulta,
         (it ->> 'rubro_id')::integer,
         nullif(it ->> 'marca_id', '')::integer,
         coalesce(trim(it ->> 'descripcion'), ''),
         (it ->> 'cantidad')::numeric::integer,
         round((it ->> 'monto')::numeric, 2)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it;
end;
$$;

-- Crea o corrige una consulta. p es un JSON con:
--   id (vacío para una nueva), local_id, fecha_consulta (vacía = ahora), canal_id,
--   estado (no_compro | lo_piensa | compro), atendio_id, nota,
--   y si compró: fecha_venta (vacía = la de la consulta), envio_id, pago_id,
--   items: [{rubro_id, marca_id, descripcion, cantidad, monto}].
-- Devuelve el id de la consulta.
create or replace function public.guardar_consulta(p jsonb)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id        bigint := nullif(p ->> 'id', '')::bigint;
  v_local     smallint := nullif(p ->> 'local_id', '')::smallint;
  v_estado    text := p ->> 'estado';
  v_admin     boolean := public.es_admin();
  v_actual    public.consultas;
  v_loc       public.locales;
  v_fecha     timestamptz;
  v_venta     timestamptz;
  v_items     jsonb := p -> 'items';
begin
  if v_id is not null then
    select * into v_actual from public.consultas where id = v_id for update;
    if not found then
      raise exception 'La consulta % no existe', v_id;
    end if;
    if v_actual.anulada then
      raise exception 'La consulta % está anulada', v_id;
    end if;
    v_local := v_actual.local_id;
  end if;

  if v_local is null or not public.puede_cargar_local(v_local) then
    raise exception 'No tenés permiso para cargar en este local';
  end if;
  select * into v_loc from public.locales where id = v_local;
  if not v_loc.activo and not v_admin then
    raise exception 'El local % está desactivado', v_loc.nombre;
  end if;

  if v_id is not null and not v_admin
     and v_actual.creado_en < now() - make_interval(hours => v_loc.horas_edicion::int) then
    raise exception 'Pasaron más de % horas desde que se cargó: solo un admin la puede corregir', v_loc.horas_edicion;
  end if;

  if v_estado is null or v_estado not in ('no_compro', 'lo_piensa', 'compro') then
    raise exception 'Estado no válido: %', coalesce(v_estado, '(vacío)');
  end if;

  v_fecha := coalesce(nullif(p ->> 'fecha_consulta', '')::timestamptz, v_actual.fecha_consulta, now());
  if v_fecha > now() + interval '5 minutes' then
    raise exception 'La fecha de la consulta no puede ser futura';
  end if;
  if not v_admin and v_fecha is distinct from v_actual.fecha_consulta
     and v_fecha < now() - make_interval(days => v_loc.dias_carga_atrasada::int) then
    raise exception 'Solo se pueden cargar consultas de hasta % días atrás', v_loc.dias_carga_atrasada;
  end if;

  if v_id is null and nullif(p ->> 'canal_id', '') is null then
    raise exception 'Falta el canal';
  end if;

  if v_estado = 'compro' then
    if nullif(p ->> 'envio_id', '') is null or nullif(p ->> 'pago_id', '') is null then
      raise exception 'Falta el método de envío o la forma de pago';
    end if;
    perform public.validar_items(v_items);
    v_venta := coalesce(nullif(p ->> 'fecha_venta', '')::timestamptz,
                        v_actual.fecha_venta,
                        case when v_actual.estado = 'lo_piensa' then now() end,
                        v_fecha);
    if v_venta > now() + interval '5 minutes' then
      raise exception 'La fecha de venta no puede ser futura';
    end if;
  else
    v_venta := null;
  end if;

  if v_id is null then
    insert into public.consultas (local_id, fecha_consulta, canal_id, estado, atendio_id,
                                  fecha_venta, envio_id, pago_id, nota)
    values (v_local, v_fecha, nullif(p ->> 'canal_id', '')::integer, v_estado,
            nullif(p ->> 'atendio_id', '')::integer,
            v_venta,
            case when v_estado = 'compro' then nullif(p ->> 'envio_id', '')::integer end,
            case when v_estado = 'compro' then nullif(p ->> 'pago_id', '')::integer end,
            coalesce(trim(p ->> 'nota'), ''))
    returning id into v_id;
  else
    update public.consultas
       set fecha_consulta = v_fecha,
           canal_id       = coalesce(nullif(p ->> 'canal_id', '')::integer, canal_id),
           estado         = v_estado,
           atendio_id     = nullif(p ->> 'atendio_id', '')::integer,
           fecha_venta    = v_venta,
           envio_id       = case when v_estado = 'compro' then nullif(p ->> 'envio_id', '')::integer end,
           pago_id        = case when v_estado = 'compro' then nullif(p ->> 'pago_id', '')::integer end,
           nota           = coalesce(trim(p ->> 'nota'), nota),
           cerrada_en     = case when v_actual.estado = 'lo_piensa' and v_estado <> 'lo_piensa' then now()
                                 when v_estado = 'lo_piensa' then null
                                 else cerrada_en end
     where id = v_id;
  end if;

  perform public.reemplazar_items(v_id, case when v_estado = 'compro' then v_items else '[]'::jsonb end);
  return v_id;
end;
$$;

-- Cierra un "Lo piensa" como compró o no compró. Se puede hacer en cualquier
-- momento (aunque haya pasado el plazo de corrección o esté vencido).
-- p: estado (compro | no_compro), atendio_id (opcional), y si compró:
--    fecha_venta (vacía = ahora), envio_id, pago_id, items.
create or replace function public.cerrar_lo_piensa(p_id bigint, p jsonb)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_actual  public.consultas;
  v_estado  text := p ->> 'estado';
  v_venta   timestamptz;
begin
  select * into v_actual from public.consultas where id = p_id for update;
  if not found then
    raise exception 'La consulta % no existe', p_id;
  end if;
  if not public.puede_cargar_local(v_actual.local_id) then
    raise exception 'No tenés permiso para cargar en este local';
  end if;
  if v_actual.anulada then
    raise exception 'La consulta % está anulada', p_id;
  end if;
  if v_actual.estado <> 'lo_piensa' then
    raise exception 'La consulta % no está en "Lo piensa"', p_id;
  end if;
  if v_estado is null or v_estado not in ('compro', 'no_compro') then
    raise exception 'Un "Lo piensa" se cierra como compró o no compró';
  end if;

  if v_estado = 'compro' then
    if nullif(p ->> 'envio_id', '') is null or nullif(p ->> 'pago_id', '') is null then
      raise exception 'Falta el método de envío o la forma de pago';
    end if;
    perform public.validar_items(p -> 'items');
    v_venta := coalesce(nullif(p ->> 'fecha_venta', '')::timestamptz, now());
    if v_venta > now() + interval '5 minutes' then
      raise exception 'La fecha de venta no puede ser futura';
    end if;
  end if;

  update public.consultas
     set estado      = v_estado,
         atendio_id  = coalesce(nullif(p ->> 'atendio_id', '')::integer, atendio_id),
         fecha_venta = v_venta,
         envio_id    = case when v_estado = 'compro' then nullif(p ->> 'envio_id', '')::integer end,
         pago_id     = case when v_estado = 'compro' then nullif(p ->> 'pago_id', '')::integer end,
         cerrada_en  = now()
   where id = p_id;

  perform public.reemplazar_items(p_id, case when v_estado = 'compro' then p -> 'items' else '[]'::jsonb end);
  return p_id;
end;
$$;

-- Anula una consulta cargada por error (no se borra: queda en el historial).
create or replace function public.anular_consulta(p_id bigint, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_actual public.consultas;
  v_horas  smallint;
begin
  select * into v_actual from public.consultas where id = p_id for update;
  if not found then
    raise exception 'La consulta % no existe', p_id;
  end if;
  if not public.puede_cargar_local(v_actual.local_id) then
    raise exception 'No tenés permiso para cargar en este local';
  end if;
  if v_actual.anulada then
    raise exception 'La consulta % ya está anulada', p_id;
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Para anular hay que escribir el motivo';
  end if;
  select horas_edicion into v_horas from public.locales where id = v_actual.local_id;
  if not public.es_admin() and v_actual.creado_en < now() - make_interval(hours => v_horas::int) then
    raise exception 'Pasaron más de % horas desde que se cargó: solo un admin la puede anular', v_horas;
  end if;

  update public.consultas
     set anulada = true, anulada_motivo = trim(p_motivo), anulada_por = auth.uid(), anulada_en = now()
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Permisos (RLS). El proyecto se crea con "Automatically expose new
--    tables" apagado: los permisos que usa la página se dan acá.
-- ---------------------------------------------------------------------
alter table public.perfiles         enable row level security;
alter table public.locales          enable row level security;
alter table public.usuarios_locales enable row level security;
alter table public.vendedores       enable row level security;
alter table public.opciones         enable row level security;
alter table public.consultas        enable row level security;
alter table public.venta_items      enable row level security;
alter table public.historial        enable row level security;

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated
  using (id = auth.uid() or public.es_admin());
drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists locales_select on public.locales;
create policy locales_select on public.locales for select to authenticated
  using (public.puede_ver_local(id));
drop policy if exists locales_admin on public.locales;
create policy locales_admin on public.locales for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists usuarios_locales_select on public.usuarios_locales;
create policy usuarios_locales_select on public.usuarios_locales for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin());
drop policy if exists usuarios_locales_admin on public.usuarios_locales;
create policy usuarios_locales_admin on public.usuarios_locales for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists vendedores_select on public.vendedores;
create policy vendedores_select on public.vendedores for select to authenticated
  using (public.puede_ver_local(local_id));
drop policy if exists vendedores_admin on public.vendedores;
create policy vendedores_admin on public.vendedores for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists opciones_select on public.opciones;
create policy opciones_select on public.opciones for select to authenticated
  using (public.puede_ver_local(local_id));
drop policy if exists opciones_admin on public.opciones;
create policy opciones_admin on public.opciones for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Consultas y artículos: solo lectura directa; se escriben con las funciones de carga.
drop policy if exists consultas_select on public.consultas;
create policy consultas_select on public.consultas for select to authenticated
  using (public.puede_ver_local(local_id));

drop policy if exists venta_items_select on public.venta_items;
create policy venta_items_select on public.venta_items for select to authenticated
  using (exists (select 1 from public.consultas c
                 where c.id = consulta_id and public.puede_ver_local(c.local_id)));

drop policy if exists historial_select on public.historial;
create policy historial_select on public.historial for select to authenticated
  using (public.es_admin());

revoke all on public.perfiles, public.locales, public.usuarios_locales, public.vendedores,
              public.opciones, public.consultas, public.venta_items, public.historial,
              public.consultas_vista, public.venta_items_vista
  from anon, public;

grant select on public.perfiles, public.locales, public.usuarios_locales, public.vendedores,
                public.opciones, public.consultas, public.venta_items, public.historial,
                public.consultas_vista, public.venta_items_vista
  to authenticated;
grant update (nombre, rol, activo) on public.perfiles to authenticated;
grant insert, update on public.locales, public.vendedores, public.opciones to authenticated;
grant insert, delete on public.usuarios_locales to authenticated;

-- Funciones: las de carga, para usuarios con sesión; las internas, para nadie de afuera.
revoke execute on all functions in schema public from anon, public;
grant execute on function public.es_admin(), public.es_usuario_activo(), public.hoy(),
                         public.puede_ver_local(smallint), public.puede_cargar_local(smallint),
                         public.guardar_consulta(jsonb), public.cerrar_lo_piensa(bigint, jsonb),
                         public.anular_consulta(bigint, text)
  to authenticated;
revoke execute on function public.reemplazar_items(bigint, jsonb), public.validar_items(jsonb),
                          public.opcion_valida(integer, smallint, text)
  from authenticated;

-- ---------------------------------------------------------------------
-- 9) Datos iniciales: los dos locales y sus listas.
--    Rubros y marcas son una primera versión: se ajustan desde la página.
-- ---------------------------------------------------------------------
insert into public.locales (nombre, color) values
  ('Cindy Minorista', '#444444'),
  ('Chimola', '#444444')
on conflict (nombre) do nothing;

insert into public.opciones (local_id, tipo, valor, orden)
select l.id, o.tipo, o.valor, o.orden
from public.locales l
cross join (values
  ('canal', 'WhatsApp', 1), ('canal', 'Instagram', 2),
  ('pago', 'Efectivo', 1), ('pago', 'Transferencia', 2), ('pago', 'QR', 3),
  ('pago', 'Tarjeta de crédito', 4), ('pago', 'Tarjeta de débito', 5),
  ('pago', 'Billetera electrónica', 6), ('pago', 'Go cuotas', 7),
  ('envio', 'Retiro en el local', 1), ('envio', 'Cadete (envío pago)', 4), ('envio', 'Transporte / correo', 5)
) as o(tipo, valor, orden)
where l.nombre in ('Cindy Minorista', 'Chimola')
on conflict do nothing;

-- Envío gratis: política de Cindy Minorista (Villa María y Villa Nueva)
insert into public.opciones (local_id, tipo, valor, orden)
select l.id, 'envio', o.valor, o.orden
from public.locales l
cross join (values ('Envío gratis a Villa María', 2), ('Envío gratis a Villa Nueva', 3)) as o(valor, orden)
where l.nombre = 'Cindy Minorista'
on conflict do nothing;

insert into public.opciones (local_id, tipo, valor, orden)
select l.id, 'rubro', o.valor, o.orden
from public.locales l
cross join (values
  ('Mochilas', 1), ('Valijas y carry on', 2), ('Bolsos', 3), ('Carteras', 4), ('Billeteras', 5),
  ('Riñoneras y morrales', 6), ('Materos', 7), ('Neceseres y organizadores', 8),
  ('Accesorios de viaje', 9), ('Loncheras y botellas', 10), ('Paraguas y pilotos', 11),
  ('Textil', 12), ('Otros', 99)
) as o(valor, orden)
where l.nombre = 'Cindy Minorista'
on conflict do nothing;

insert into public.opciones (local_id, tipo, valor, orden)
select l.id, 'marca', o.valor, o.orden
from public.locales l
cross join (values
  ('Amayra', 1), ('American Tourister', 2), ('Bagcherry', 3), ('Chimola', 4), ('David Jones', 5),
  ('Discovery', 6), ('Disney', 7), ('Everlast', 8), ('Las Oreiro', 9), ('Samsonite', 10),
  ('Skora', 11), ('Travel Blue', 12), ('Trendy', 13), ('Unicross', 14), ('Wanderlust', 15),
  ('Wilson', 16), ('Xtrem', 17), ('Otra', 99)
) as o(valor, orden)
where l.nombre = 'Cindy Minorista'
on conflict do nothing;

insert into public.opciones (local_id, tipo, valor, orden)
select l.id, 'rubro', o.valor, o.orden
from public.locales l
cross join (values
  ('Billeteras', 1), ('Carteras', 2), ('Mochilas', 3), ('Accesorios', 4), ('Deco', 5),
  ('Textil', 6), ('Otros', 99)
) as o(valor, orden)
where l.nombre = 'Chimola'
on conflict do nothing;

-- Chimola vende una sola marca: la página la elige sola
insert into public.opciones (local_id, tipo, valor, orden)
select l.id, 'marca', 'Chimola', 1
from public.locales l
where l.nombre = 'Chimola'
on conflict do nothing;
