-- =====================================================================
--  Datos del cliente en las consultas que quedan en "Lo piensa".
--  Para poder seguirla hace falta saber quién es: nombre completo y
--  teléfono (WhatsApp) o usuario (Instagram). La base lo exige al cargar
--  o corregir una consulta en "Lo piensa"; en las otras es opcional.
--  Al cerrarla (compró / no compró) los datos quedan guardados.
--  Lo importado de la planilla vieja no los trae: queda exceptuado.
--  Se puede volver a correr.
-- =====================================================================

alter table public.consultas
  add column if not exists cliente_nombre   text not null default '',
  add column if not exists cliente_contacto text not null default '';

-- "not valid": controla lo que se carga de ahora en más, sin revisar lo que ya hubiera
alter table public.consultas drop constraint if exists lo_piensa_con_cliente;
alter table public.consultas add constraint lo_piensa_con_cliente check (
  estado <> 'lo_piensa' or origen = 'importacion'
  or (length(trim(cliente_nombre)) > 0 and length(trim(cliente_contacto)) > 0)) not valid;
alter table public.consultas drop constraint if exists cliente_largo;
alter table public.consultas add constraint cliente_largo check (
  length(cliente_nombre) <= 120 and length(cliente_contacto) <= 80) not valid;

-- Igual que en la migración 1, más los datos del cliente
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

  -- Datos del cliente: si no vienen en el pedido, quedan los que ya tenía
  v_nombre   := left(trim(coalesce(p ->> 'cliente_nombre', v_actual.cliente_nombre, '')), 120);
  v_contacto := left(trim(coalesce(p ->> 'cliente_contacto', v_actual.cliente_contacto, '')), 80);
  if v_estado = 'lo_piensa' and (v_nombre = '' or v_contacto = '') then
    raise exception 'Para dejarla en "Lo piensa" falta el nombre completo y el teléfono o usuario del cliente';
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

-- La vista de consultas, con los datos del cliente al final
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
  (c.creado_en >= now() - make_interval(hours => l.horas_edicion::int)) as editable_por_local,
  -- Agregadas en la migración 3 (van al final para poder reemplazar la vista)
  c.cliente_nombre,
  c.cliente_contacto
from public.consultas c
join public.locales l       on l.id = c.local_id
join public.opciones ca     on ca.id = c.canal_id
left join public.vendedores v on v.id = c.atendio_id
left join public.opciones en  on en.id = c.envio_id
left join public.opciones pa  on pa.id = c.pago_id;

revoke all on public.consultas_vista from anon, public;
grant select on public.consultas_vista to authenticated;
grant execute on function public.guardar_consulta(jsonb) to authenticated;
