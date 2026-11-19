-- Run in the Supabase SQL editor. All writes use the revision-checked RPC.
create table if not exists public.workbench_documents (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint document_object check (jsonb_typeof(document) = 'object')
);
alter table public.workbench_documents enable row level security;
revoke all on public.workbench_documents from anon, authenticated;
grant select on public.workbench_documents to authenticated;
drop policy if exists read_own_documents on public.workbench_documents;
create policy read_own_documents on public.workbench_documents for select to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.save_workbench_document(doc_id uuid, expected_revision integer, body jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare existing public.workbench_documents; result integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if body is null or jsonb_typeof(body) <> 'object' or jsonb_typeof(body->'payload') <> 'object'
     or length(body->>'name') not between 1 and 100
     or not (body ?& array['name','payload','versions','updated','deleted'])
     or jsonb_typeof(body->'versions') <> 'array' or jsonb_array_length(body->'versions') > 10
     or jsonb_typeof(body->'deleted') <> 'boolean'
     or octet_length(body::text) > 2000000 then raise exception 'Invalid document'; end if;
  -- Serialize creation as well as updates; a racing writer must retry and keep its local copy.
  perform pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  select * into existing from public.workbench_documents where id=doc_id for update;
  if found then
    if existing.owner_id <> auth.uid() or existing.revision <> expected_revision then
      raise exception 'Revision conflict';
    end if;
    update public.workbench_documents set document=body, revision=revision+1, updated_at=now()
      where id=doc_id returning revision into result;
  else
    if expected_revision <> 0 then raise exception 'Revision conflict'; end if;
    insert into public.workbench_documents(id,owner_id,document) values(doc_id,auth.uid(),body)
      returning revision into result;
  end if;
  return result;
end;
$$;
revoke all on function public.save_workbench_document(uuid,integer,jsonb) from public, anon;
grant execute on function public.save_workbench_document(uuid,integer,jsonb) to authenticated;
