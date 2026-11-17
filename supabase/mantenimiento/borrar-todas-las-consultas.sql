-- =====================================================================
--  BORRAR TODAS LAS CONSULTAS (para arrancar en limpio después de las pruebas)
--
--  Qué borra: todas las consultas, sus artículos vendidos y el historial de
--  cambios. Los números de consulta vuelven a empezar desde 1.
--  Qué NO toca: usuarios, perfiles, locales, listas (canales, envíos,
--  pagos, rubros, marcas), empleados ni la configuración de cada local.
--
--  ES DEFINITIVO: no se puede deshacer (Supabase no guarda copias en el
--  plan gratis). No es una migración: se corre UNA vez, a mano, en
--  Supabase -> SQL Editor. No va en supabase/migrations.
--
--  Paso 1 (opcional): ver cuánto hay antes de borrar. Seleccioná solo este
--  bloque y Run:
--
--    select (select count(*) from public.consultas)   as consultas,
--           (select count(*) from public.venta_items) as articulos,
--           (select count(*) from public.historial)   as historial;
--
--  Paso 2: correr el script completo (Run). Al final muestra los tres
--  conteos en 0.
-- =====================================================================

begin;

-- TRUNCATE no dispara los triggers de historial ni de montos, y reinicia los números (restart identity)
truncate table public.venta_items, public.consultas, public.historial restart identity;

commit;

select (select count(*) from public.consultas)   as consultas,
       (select count(*) from public.venta_items) as articulos,
       (select count(*) from public.historial)   as historial;
