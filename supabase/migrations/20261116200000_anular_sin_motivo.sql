-- =====================================================================
--  Anular sin motivo.
--  Antes (migración 1) para anular una consulta había que escribir el
--  motivo. Ahora se anula con un toque: si no llega motivo se guarda
--  "Sin motivo" (así la regla anulacion_con_motivo de la tabla se sigue
--  cumpliendo y en la planilla se ve igual que antes). Quién y cuándo
--  anuló sigue quedando registrado. Se puede volver a correr.
-- =====================================================================

-- Igual que en la migración 1, sin exigir el motivo
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
  select horas_edicion into v_horas from public.locales where id = v_actual.local_id;
  if not public.es_admin() and v_actual.creado_en < now() - make_interval(hours => v_horas::int) then
    raise exception 'Pasaron más de % horas desde que se cargó: solo un admin la puede anular', v_horas;
  end if;

  update public.consultas
     set anulada = true, anulada_motivo = coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Sin motivo'),
         anulada_por = auth.uid(), anulada_en = now()
   where id = p_id;
end;
$$;

grant execute on function public.anular_consulta(bigint, text) to authenticated;
