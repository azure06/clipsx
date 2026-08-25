-- Apply on a Supabase development branch first. This file is promoted through
-- the reviewed Supabase migration workflow; it is not executed by the desktop app.
begin;

create sequence if not exists public.sync_server_cursor_seq as bigint;

create table if not exists public.sync_devices (
    user_id uuid not null references auth.users(id) on delete cascade,
    device_id text not null check (length(device_id) between 1 and 120),
    display_name text not null check (length(display_name) between 1 and 120),
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    revoked_at timestamptz,
    primary key (user_id, device_id)
);

create table if not exists public.sync_records (
    user_id uuid not null references auth.users(id) on delete cascade,
    record_kind text not null check (record_kind in (
        'profile_setting',
        'renderer_preference',
        'extension_intent',
        'extension_setting',
        'shortcut'
    )),
    record_key text not null check (length(record_key) between 1 and 512),
    payload jsonb,
    tombstone boolean not null default false,
    source_device_id text not null,
    revision_physical_ms bigint not null check (revision_physical_ms >= 0),
    revision_counter bigint not null check (revision_counter >= 0),
    server_cursor bigint not null default nextval('public.sync_server_cursor_seq'),
    updated_at timestamptz not null default now(),
    primary key (user_id, record_kind, record_key),
    unique (user_id, server_cursor),
    foreign key (user_id, source_device_id)
        references public.sync_devices(user_id, device_id)
        on delete restrict,
    check (octet_length(coalesce(payload, 'null'::jsonb)::text) <= 65536),
    check ((tombstone and payload is null) or not tombstone)
);

create index if not exists sync_records_user_cursor_idx
on public.sync_records(user_id, server_cursor);

create index if not exists sync_records_source_device_idx
on public.sync_records(user_id, source_device_id);

alter table public.sync_devices enable row level security;
alter table public.sync_records enable row level security;

revoke all on table public.sync_devices from public, anon, authenticated;
revoke all on table public.sync_records from public, anon, authenticated;
revoke all on sequence public.sync_server_cursor_seq from public, anon, authenticated;

grant select, insert, update on table public.sync_devices to authenticated;
grant select, insert, update on table public.sync_records to authenticated;
grant usage, select on sequence public.sync_server_cursor_seq to authenticated;

drop policy if exists sync_devices_select_own on public.sync_devices;
create policy sync_devices_select_own
on public.sync_devices for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sync_devices_insert_own on public.sync_devices;
create policy sync_devices_insert_own
on public.sync_devices for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sync_devices_update_own on public.sync_devices;
create policy sync_devices_update_own
on public.sync_devices for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sync_records_select_own on public.sync_records;
create policy sync_records_select_own
on public.sync_records for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sync_records_insert_own on public.sync_records;
create policy sync_records_insert_own
on public.sync_records for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sync_records_update_own on public.sync_records;
create policy sync_records_update_own
on public.sync_records for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.sync_apply_batch(
    p_device_id text,
    p_device_name text,
    p_after_cursor bigint,
    p_records jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_record jsonb;
    v_kind text;
    v_key text;
    v_tombstone boolean;
    v_physical bigint;
    v_counter bigint;
    v_records jsonb;
    v_cursor bigint;
begin
    if v_user_id is null then
        raise exception 'authentication required';
    end if;
    if p_device_id is null or length(p_device_id) not between 1 and 120
       or p_device_name is null or length(p_device_name) not between 1 and 120 then
        raise exception 'invalid sync device identity';
    end if;
    if p_after_cursor is null or p_after_cursor < 0 then
        raise exception 'invalid sync cursor';
    end if;
    if p_records is null or jsonb_typeof(p_records) <> 'array'
       or jsonb_array_length(p_records) > 500 then
        raise exception 'sync batch must contain at most 500 records';
    end if;

    insert into public.sync_devices(user_id, device_id, display_name, last_seen_at)
    values (v_user_id, p_device_id, p_device_name, now())
    on conflict (user_id, device_id) do update
    set display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at
    where public.sync_devices.revoked_at is null;

    if not exists (
        select 1 from public.sync_devices
        where user_id = v_user_id and device_id = p_device_id and revoked_at is null
    ) then
        raise exception 'sync device is revoked';
    end if;

    for v_record in select value from jsonb_array_elements(p_records)
    loop
        v_kind := v_record->>'kind';
        v_key := v_record->>'key';
        v_tombstone := coalesce((v_record->>'tombstone')::boolean, false);
        v_physical := (v_record->>'revisionPhysicalMs')::bigint;
        v_counter := (v_record->>'revisionCounter')::bigint;

        if v_kind not in ('profile_setting', 'renderer_preference', 'extension_intent', 'extension_setting', 'shortcut')
           or v_key is null or length(v_key) not between 1 and 512
           or v_physical < 0 or v_counter < 0
           or octet_length(coalesce(v_record->'payload', 'null'::jsonb)::text) > 65536 then
            raise exception 'invalid sync record';
        end if;

        insert into public.sync_records(
            user_id, record_kind, record_key, payload, tombstone,
            source_device_id, revision_physical_ms, revision_counter
        ) values (
            v_user_id, v_kind, v_key,
            case when v_tombstone then null else v_record->'payload' end,
            v_tombstone, p_device_id, v_physical, v_counter
        )
        on conflict (user_id, record_kind, record_key) do update
        set payload = excluded.payload,
            tombstone = excluded.tombstone,
            source_device_id = excluded.source_device_id,
            revision_physical_ms = excluded.revision_physical_ms,
            revision_counter = excluded.revision_counter,
            server_cursor = nextval('public.sync_server_cursor_seq'),
            updated_at = now()
        where (
            excluded.revision_physical_ms,
            excluded.revision_counter,
            excluded.source_device_id
        ) > (
            public.sync_records.revision_physical_ms,
            public.sync_records.revision_counter,
            public.sync_records.source_device_id
        );
    end loop;

    select
        coalesce(jsonb_agg(jsonb_build_object(
            'kind', records.record_kind,
            'key', records.record_key,
            'payload', records.payload,
            'tombstone', records.tombstone,
            'sourceDeviceId', records.source_device_id,
            'revisionPhysicalMs', records.revision_physical_ms,
            'revisionCounter', records.revision_counter,
            'serverCursor', records.server_cursor
        ) order by records.server_cursor), '[]'::jsonb),
        coalesce(max(records.server_cursor), p_after_cursor)
    into v_records, v_cursor
    from (
        select * from public.sync_records
        where user_id = v_user_id and server_cursor > p_after_cursor
        order by server_cursor
        limit 1000
    ) as records;

    return jsonb_build_object('cursor', v_cursor, 'records', v_records);
end;
$$;

revoke execute on function public.sync_apply_batch(text, text, bigint, jsonb)
from public, anon;
grant execute on function public.sync_apply_batch(text, text, bigint, jsonb)
to authenticated;

-- Existing project audit: this event-trigger helper is not a client RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

commit;

