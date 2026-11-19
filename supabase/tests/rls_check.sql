-- Row-level security check for Phase 1 (test cases T1.3 and T1.4).
-- Run in the Supabase SQL editor AFTER at least two people have signed up.
-- It impersonates real users inside a transaction and rolls everything back.
-- Each line of output should say PASS.

begin;

-- Pick two existing non-admin users.
create temp table _u on commit drop as
  select id, row_number() over (order by created_at) as n
  from public.profiles where role <> 'admin' limit 2;

do $$
declare
  a uuid := (select id from _u where n = 1);
  b uuid := (select id from _u where n = 2);
  seen int;
begin
  if a is null or b is null then
    raise exception 'Need two signed-up non-admin users to run this check';
  end if;

  -- Give user B a traveller to look for.
  insert into public.travellers (user_id, full_name_as_on_id, date_of_birth, gender)
  values (b, 'Rls Test Person', '1990-01-01', 'other');

  -- Act as user A.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into seen from public.profiles where id = b;
  raise notice '% T1.4 user A cannot read user B profile', case when seen = 0 then 'PASS' else 'FAIL' end;

  select count(*) into seen from public.travellers where user_id = b;
  raise notice '% T1.4 user A cannot read user B travellers', case when seen = 0 then 'PASS' else 'FAIL' end;

  update public.travellers set full_name_as_on_id = 'Hacked' where user_id = b;
  get diagnostics seen = row_count;
  raise notice '% T1.4 user A cannot edit user B travellers', case when seen = 0 then 'PASS' else 'FAIL' end;

  begin
    insert into public.travellers (user_id, full_name_as_on_id, date_of_birth, gender)
    values (b, 'Planted', '1990-01-01', 'other');
    raise notice 'FAIL T1.4 user A inserted a traveller for user B';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS T1.4 user A cannot add travellers to user B';
  end;

  begin
    update public.profiles set role = 'admin' where id = a;
    raise notice 'FAIL T1.3 user A promoted themselves to admin';
  exception when insufficient_privilege then
    raise notice 'PASS T1.3 user A cannot make themselves admin';
  end;

  select count(*) into seen from public.audit_log;
  raise notice '% T1.3 non-admin cannot read the audit log', case when seen = 0 then 'PASS' else 'FAIL' end;

  reset role;
end $$;

rollback;
