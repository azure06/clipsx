begin;

select plan(6);

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one@clipsx.test', '', now(), now()),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two@clipsx.test', '', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select lives_ok(
    $$select public.sync_apply_batch('device-one', 'Device one', 0, '[{"kind":"profile_setting","key":"ui.theme","payload":"dark","tombstone":false,"revisionPhysicalMs":1,"revisionCounter":0}]'::jsonb)$$,
    'authenticated user can write a valid batch'
);
select is((select count(*) from public.sync_records), 1::bigint, 'owner sees one record');
select throws_ok(
    $$insert into public.sync_records(user_id,record_kind,record_key,payload,tombstone,source_device_id,revision_physical_ms,revision_counter) values('22222222-2222-2222-2222-222222222222','profile_setting','ui.theme','"light"',false,'device-one',2,0)$$,
    '42501', null, 'cannot insert another user record'
);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select is((select count(*) from public.sync_records), 0::bigint, 'second user cannot read first user records');
select is((select count(*) from public.sync_devices), 0::bigint, 'second user cannot read first user devices');
select throws_ok(
    $$delete from public.sync_records$$,
    '42501', null, 'authenticated clients have no direct delete grant'
);

select * from finish();
rollback;
