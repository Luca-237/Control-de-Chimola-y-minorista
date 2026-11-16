-- =====================================================================
--  Productos fuera del catálogo "tal como se escriben".
--  Antes (migración 2) un artículo que no venía del buscador tenía que
--  llevar un rubro de la lista. Ahora alcanza con el nombre del producto
--  tal como lo escribió el local (se guarda en descripcion); el rubro pasa
--  a ser opcional. Los del buscador siguen pidiendo producto y categoría.
--  Va después de la migración 2. Se puede volver a correr.
-- =====================================================================

-- Igual que en la migración 2, con la regla nueva para los productos fuera del catálogo
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
    elsif nullif(it ->> 'rubro_id', '') is null and nullif(trim(coalesce(it ->> 'descripcion', '')), '') is null then
      -- Fuera del catálogo alcanza con el nombre tal como se escribió (va en descripcion); el rubro es opcional
      raise exception 'Falta el nombre del producto de un artículo';
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

revoke execute on function public.validar_items(jsonb) from anon, authenticated, public;
