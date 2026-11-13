-- =====================================================================
--  Producto elegido del catálogo (buscador mientras se escribe).
--  Cada artículo vendido puede guardar el producto y su categoría tal como
--  estaban en la tienda al momento de la venta (copiados, no enlazados):
--  así las estadísticas de categorías salen de esta base y no cambian si
--  después se renombra o se mueve el producto en la tienda.
--
--  Un artículo es de uno de dos tipos:
--    catalogo = true   -> producto del buscador: lleva producto y categoría
--                         (el rubro y la marca de las listas ya no hacen falta).
--    catalogo = false  -> producto que no está en el catálogo (texto libre) o
--                         cargado antes del buscador: sigue llevando rubro.
--  La categoría se guarda con su ruta completa ("Marroquinería > Mochilas >
--  Infantiles"); el rubro web es el primer tramo y el subrubro el segundo.
--  Se puede volver a correr.
-- =====================================================================

alter table public.venta_items
  add column if not exists producto        text    not null default '',
  add column if not exists producto_clave  text    not null default '',
  add column if not exists categoria       text    not null default '',
  add column if not exists categoria_ruta  text    not null default '',
  add column if not exists categoria_tn_id bigint,
  add column if not exists catalogo        boolean not null default false;

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
    if coalesce((it ->> 'catalogo')::boolean, false) then
      if nullif(trim(coalesce(it ->> 'producto', '')), '') is null then
        raise exception 'Falta el producto de un artículo';
      end if;
      if nullif(trim(coalesce(it ->> 'categoria', '')), '') is null then
        raise exception 'Falta la categoría del producto de un artículo';
      end if;
    elsif nullif(it ->> 'rubro_id', '') is null then
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
  insert into public.venta_items (consulta_id, rubro_id, marca_id, descripcion, cantidad, monto,
                                  producto, producto_clave, categoria, categoria_ruta, categoria_tn_id, catalogo)
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
         coalesce((it ->> 'catalogo')::boolean, false)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it;
end;
$$;

-- Vista de artículos: las columnas de antes y, al final, las del catálogo
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
  nullif(split_part(i.categoria_ruta, ' > ', 2), '') as subrubro_web
from public.venta_items i
join public.consultas c    on c.id = i.consulta_id
left join public.opciones r on r.id = i.rubro_id
left join public.opciones m on m.id = i.marca_id
where not c.anulada;
