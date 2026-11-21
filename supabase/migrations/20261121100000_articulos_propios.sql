-- =====================================================================
--  Lista de artículos propia de un local (pedido de Luca, 21/11/2026).
--  Chimola usa sus propios códigos (BT256, TX64, L01-G…), no los de Odoo
--  que usa Cindy Minorista (Peatonal). Cada local dice de dónde salen sus
--  productos (locales.catalogo):
--    'odoo'    -> buscador de Odoo (función buscar-productos), como hasta ahora
--    'propio'  -> la lista de artículos del local (tabla articulos_local)
--  La lista se carga y se actualiza subiendo la planilla desde Configuración
--  (solo admin, función importar_articulos). Cada artículo vendido guarda
--  además su código (venta_items.producto_codigo).
--  Va después de las migraciones 1 a 8. Se puede volver a correr.
-- =====================================================================

-- 1) De dónde salen los productos de cada local
alter table public.locales add column if not exists catalogo text not null default 'odoo';
alter table public.locales drop constraint if exists locales_catalogo_valido;
alter table public.locales add constraint locales_catalogo_valido check (catalogo in ('odoo', 'propio'));
update public.locales set catalogo = 'propio' where nombre ilike 'chimola%' and catalogo = 'odoo';

-- 2) Lista de artículos del local
create table if not exists public.articulos_local (
  local_id        smallint not null references public.locales(id) on delete cascade,
  codigo          text not null check (length(trim(codigo)) between 1 and 40),
  nombre          text not null check (length(trim(nombre)) between 1 and 200),
  rubro           text not null default '',
  temporada       text not null default '',
  activo          boolean not null default true,
  actualizado_en  timestamptz not null default now(),
  primary key (local_id, codigo)
);

alter table public.articulos_local enable row level security;
drop policy if exists articulos_local_ver on public.articulos_local;
create policy articulos_local_ver on public.articulos_local for select to authenticated
  using (public.puede_ver_local(local_id));
-- Sin políticas de escritura: se carga solo con importar_articulos (admin)
grant select on public.articulos_local to authenticated;

-- Para comparar sin mayúsculas ni tildes ("Portacosméticos" = "portacosmeticos")
create or replace function public.texto_plano(t text)
returns text
language sql immutable
as $$
  select translate(lower(coalesce(t, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc');
$$;

-- 3) Buscador: por código o por palabras del nombre / rubro, sin importar el orden.
--    p_exacto = true: solo el código exacto (pistola de código de barras).
--    Primero el código exacto, después los códigos que empiezan con lo escrito, después los nombres que empiezan con lo escrito.
create or replace function public.buscar_articulos(p_local smallint, p_q text, p_limite int default 8, p_exacto boolean default false)
returns table (codigo text, nombre text, rubro text, temporada text)
language sql stable security invoker set search_path = public
as $$
  with q as (
    select public.texto_plano(trim(coalesce(p_q, ''))) as t,
           array(select w from unnest(regexp_split_to_array(public.texto_plano(trim(coalesce(p_q, ''))), '\s+')) w
                 where length(w) >= 1 limit 5) as palabras
  )
  select a.codigo, a.nombre, a.rubro, a.temporada
  from public.articulos_local a, q
  where a.local_id = p_local and a.activo and length(q.t) >= 1
    and (case when p_exacto then lower(a.codigo) = q.t
              else (select bool_and(public.texto_plano(a.nombre || ' ' || a.codigo || ' ' || a.rubro) like '%' || w || '%')
                    from unnest(q.palabras) w) end)
  order by (lower(a.codigo) = q.t) desc,
           (lower(a.codigo) like q.t || '%') desc,
           (public.texto_plano(a.nombre) like q.t || '%') desc,
           a.nombre, a.codigo
  limit least(greatest(coalesce(p_limite, 8), 1), 30);
$$;
grant execute on function public.buscar_articulos(smallint, text, int, boolean) to authenticated;

-- 4) Carga de la planilla (solo admin). p_filas: [{ codigo, nombre, rubro, temporada }]
--    Agrega los nuevos, actualiza los que cambiaron y, si p_desactivar, saca del buscador los que ya no están
--    (no se borran: las ventas viejas los siguen nombrando). Devuelve cuántos de cada uno.
create or replace function public.importar_articulos(p_local smallint, p_filas jsonb, p_desactivar boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_nuevos int; v_cambiados int; v_desactivados int := 0; v_total int;
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede cargar la lista de artículos';
  end if;
  if not exists (select 1 from public.locales where id = p_local) then
    raise exception 'El local % no existe', p_local;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'La planilla no tiene artículos';
  end if;

  drop table if exists _nuevos;
  create temp table _nuevos on commit drop as
  select distinct on (lower(codigo)) codigo, nombre, rubro, temporada
  from (select left(trim(f ->> 'codigo'), 40) as codigo,
               left(regexp_replace(trim(coalesce(f ->> 'nombre', '')), '\s+', ' ', 'g'), 200) as nombre,
               left(trim(coalesce(f ->> 'rubro', '')), 80) as rubro,
               left(trim(coalesce(f ->> 'temporada', '')), 80) as temporada
        from jsonb_array_elements(p_filas) f) x
  where coalesce(codigo, '') <> '' and nombre <> '';
  select count(*) into v_total from _nuevos;
  if v_total = 0 then
    raise exception 'La planilla no tiene artículos con código y descripción';
  end if;

  select count(*) into v_nuevos from _nuevos n
  where not exists (select 1 from public.articulos_local a where a.local_id = p_local and lower(a.codigo) = lower(n.codigo));
  select count(*) into v_cambiados from _nuevos n join public.articulos_local a on a.local_id = p_local and lower(a.codigo) = lower(n.codigo)
  where (a.nombre, a.rubro, a.temporada, a.activo) is distinct from (n.nombre, n.rubro, n.temporada, true);

  -- Si el código ya existía con otras mayúsculas, se conserva como estaba escrito
  insert into public.articulos_local as a (local_id, codigo, nombre, rubro, temporada, activo, actualizado_en)
  select p_local, coalesce((select a2.codigo from public.articulos_local a2 where a2.local_id = p_local and lower(a2.codigo) = lower(n.codigo)), n.codigo),
         n.nombre, n.rubro, n.temporada, true, now()
  from _nuevos n
  on conflict (local_id, codigo) do update
    set nombre = excluded.nombre, rubro = excluded.rubro, temporada = excluded.temporada, activo = true,
        actualizado_en = case when (a.nombre, a.rubro, a.temporada, a.activo) is distinct from (excluded.nombre, excluded.rubro, excluded.temporada, true)
                              then now() else a.actualizado_en end;

  if p_desactivar then
    update public.articulos_local a set activo = false, actualizado_en = now()
    where a.local_id = p_local and a.activo
      and not exists (select 1 from _nuevos n where lower(n.codigo) = lower(a.codigo));
    get diagnostics v_desactivados = row_count;
  end if;

  return jsonb_build_object('total', v_total, 'nuevos', v_nuevos, 'actualizados', v_cambiados, 'desactivados', v_desactivados);
end;
$$;
revoke execute on function public.importar_articulos(smallint, jsonb, boolean) from anon, public;
grant execute on function public.importar_articulos(smallint, jsonb, boolean) to authenticated;

-- 5) Cada artículo vendido guarda su código (el de Odoo queda vacío: Odoo agrupa varios códigos en un resultado)
alter table public.venta_items add column if not exists producto_codigo text not null default '';

create or replace function public.reemplazar_items(p_consulta bigint, p_items jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.venta_items where consulta_id = p_consulta;
  insert into public.venta_items (consulta_id, rubro_id, marca_id, descripcion, cantidad, monto,
                                  producto, producto_clave, categoria, categoria_ruta, categoria_tn_id, catalogo, producto_codigo)
  select p_consulta,
         nullif(it ->> 'rubro_id', '')::integer,
         nullif(it ->> 'marca_id', '')::integer,
         coalesce(trim(it ->> 'descripcion'), ''),
         (it ->> 'cantidad')::numeric::integer,
         round((it ->> 'monto')::numeric, 2),
         case when coalesce((it ->> 'catalogo')::boolean, false) then left(trim(it ->> 'producto'), 200) else '' end,
         case when coalesce((it ->> 'catalogo')::boolean, false) then left(coalesce(it ->> 'producto_clave', ''), 260) else '' end,
         case when coalesce((it ->> 'catalogo')::boolean, false) then left(trim(it ->> 'categoria'), 120) else '' end,
         case when coalesce((it ->> 'catalogo')::boolean, false) then left(coalesce(trim(it ->> 'categoria_ruta'), ''), 400) else '' end,
         case when coalesce((it ->> 'catalogo')::boolean, false) then nullif(it ->> 'categoria_tn_id', '')::bigint end,
         coalesce((it ->> 'catalogo')::boolean, false),
         case when coalesce((it ->> 'catalogo')::boolean, false) then left(coalesce(trim(it ->> 'producto_codigo'), ''), 40) else '' end
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it;
end;
$$;
revoke execute on function public.reemplazar_items(bigint, jsonb) from anon, authenticated, public;

-- Vista de artículos: igual que en la migración 2, con el código al final
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
  i.monto,
  i.producto,
  i.producto_clave,
  i.categoria,
  i.categoria_ruta,
  i.categoria_tn_id,
  i.catalogo,
  nullif(split_part(i.categoria_ruta, ' > ', 1), '') as rubro_web,
  nullif(split_part(i.categoria_ruta, ' > ', 2), '') as subrubro_web,
  i.producto_codigo
from public.venta_items i
join public.consultas c    on c.id = i.consulta_id
left join public.opciones r on r.id = i.rubro_id
left join public.opciones m on m.id = i.marca_id
where not c.anulada;
