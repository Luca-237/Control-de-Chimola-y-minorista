-- =====================================================================
--  Datos opcionales al cargar (pedido de Luca, 19/11/2026).
--  - Cliente: nombre, teléfono y usuario son todos opcionales, también en
--    "Lo piensa" (antes hacía falta al menos uno).
--  - Artículos fuera del catálogo: no hace falta ni el nombre ni el rubro.
--    Si no se eligió nada del buscador, se guarda lo escrito tal cual (o
--    vacío) y en las estadísticas cuenta como "Otros".
--  Va después de las migraciones 4 y 5. Se puede volver a correr.
-- =====================================================================

alter table public.consultas drop constraint if exists lo_piensa_con_cliente;

-- Igual que en la migración 4, sin pedir datos del cliente
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
  v_nombre    text;
  v_contacto  text;
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

  -- Datos del cliente (todos opcionales): si no vienen en el pedido, quedan los que ya tenía
  v_nombre   := left(trim(coalesce(p ->> 'cliente_nombre', v_actual.cliente_nombre, '')), 120);
  v_contacto := left(trim(coalesce(p ->> 'cliente_contacto', v_actual.cliente_contacto, '')), 80);

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
                                  fecha_venta, envio_id, pago_id, nota,
                                  cliente_nombre, cliente_contacto)
    values (v_local, v_fecha, nullif(p ->> 'canal_id', '')::integer, v_estado,
            nullif(p ->> 'atendio_id', '')::integer,
            v_venta,
            case when v_estado = 'compro' then nullif(p ->> 'envio_id', '')::integer end,
            case when v_estado = 'compro' then nullif(p ->> 'pago_id', '')::integer end,
            coalesce(trim(p ->> 'nota'), ''),
            v_nombre, v_contacto)
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
           cliente_nombre   = v_nombre,
           cliente_contacto = v_contacto,
           cerrada_en     = case when v_actual.estado = 'lo_piensa' and v_estado <> 'lo_piensa' then now()
                                 when v_estado = 'lo_piensa' then null
                                 else cerrada_en end
     where id = v_id;
  end if;

  perform public.reemplazar_items(v_id, case when v_estado = 'compro' then v_items else '[]'::jsonb end);
  return v_id;
end;
$$;

grant execute on function public.guardar_consulta(jsonb) to authenticated;

-- Igual que en la migración 5, sin pedir el nombre de los productos fuera del catálogo
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
    -- Fuera del catálogo no se pide nada: ni nombre, ni rubro (si no se escribió nada, cuenta como "Otros")
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
