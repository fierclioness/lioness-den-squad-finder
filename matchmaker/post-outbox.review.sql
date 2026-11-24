-- REVIEW-ONLY, development SQL. DO NOT apply to the user's Supabase project.
-- Requires supabase-schema.review.sql and storage-operations.review.sql.
begin;
create table if not exists matchmaker_internal.post_outbox (
 listing_id bigint primary key references matchmaker_internal.squad_listings(id) on delete restrict,
 state text not null default 'pending'
   check (state in ('pending','sending','posted','uncertain','failed','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 claimed_by uuid,
 claimed_at timestamptz,
 posted_message_id text unique check(posted_message_id is null or posted_message_id ~ '^[0-9]{15,22}$'),
 last_error text check(last_error is null or length(last_error)<=200),
 updated_at timestamptz not null default now(),
 check ((state='sending')=(claimed_by is not null)),
 check (state<>'posted' or posted_message_id is not null)
);
create index if not exists post_outbox_retry_idx
 on matchmaker_internal.post_outbox(state,updated_at) where state in ('pending','failed');
alter table matchmaker_internal.post_outbox enable row level security;
revoke all on matchmaker_internal.post_outbox from public,anon,authenticated;
grant select,insert,update,delete on matchmaker_internal.post_outbox to service_role;

-- One outbox item per listing, using unique listing_id to prevent duplicate enqueue.
create or replace function matchmaker_internal.enqueue_post(p_listing_id bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_added integer;
begin
 insert into matchmaker_internal.post_outbox(listing_id)
 select s.id from matchmaker_internal.squad_listings s
 where s.id=p_listing_id and s.status='active' and s.expires_at>clock_timestamp()
 on conflict(listing_id) do nothing;
 get diagnostics v_added=row_count;
 return v_added=1;
end $$;

-- Atomic worker claim. Does not retry uncertain deliveries because Discord may already have posted.
create or replace function matchmaker_internal.claim_post(p_worker uuid)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v_id bigint;
begin
 if p_worker is null then raise exception 'Worker ID required'; end if;
 with next as (
  select o.listing_id from matchmaker_internal.post_outbox o
  join matchmaker_internal.squad_listings s on s.id=o.listing_id
  where o.state in ('pending','failed') and o.attempts<3
    and s.status='active' and s.expires_at>clock_timestamp()
  order by o.updated_at,o.listing_id
  for update of o skip locked limit 1
 )
 update matchmaker_internal.post_outbox o
 set state='sending',attempts=o.attempts+1,claimed_by=p_worker,
     claimed_at=clock_timestamp(),updated_at=clock_timestamp()
 from next where o.listing_id=next.listing_id
 returning o.listing_id into v_id;
 return v_id;
end $$;

-- Only the owning worker may mark a post as confirmed by Discord with a genuine message id.
create or replace function matchmaker_internal.finish_post(
 p_listing_id bigint,p_worker uuid,p_message_id text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_changed integer;
begin
 if p_message_id !~ '^[0-9]{15,22}$' then raise exception 'Invalid Discord message ID'; end if;
 update matchmaker_internal.post_outbox
 set state='posted',posted_message_id=p_message_id,claimed_by=null,
     claimed_at=null,last_error=null,updated_at=clock_timestamp()
 where listing_id=p_listing_id and state='sending' and claimed_by=p_worker;
 get diagnostics v_changed=row_count;
 return v_changed=1;
end $$;

-- Definitively unsent errors can retry (maximum three claims).
-- A timeout, dropped connection or Discord 5xx is AMBIGUOUS and MUST become uncertain.
-- uncertain never auto-claims again; manual check against Discord before any resolution.
create or replace function matchmaker_internal.fail_post(
 p_listing_id bigint,p_worker uuid,p_definitely_not_sent boolean,p_reason text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_changed integer;
begin
 update matchmaker_internal.post_outbox
 set state=case when p_definitely_not_sent is true then 'failed' else 'uncertain' end,
     claimed_by=null,claimed_at=null,
     last_error=left(coalesce(p_reason,'delivery not confirmed'),200),
     updated_at=clock_timestamp()
 where listing_id=p_listing_id and state='sending' and claimed_by=p_worker;
 get diagnostics v_changed=row_count;
 return v_changed=1;
end $$;

create or replace function matchmaker_internal.cancel_unposted(p_listing_id bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_changed integer;
begin
 update matchmaker_internal.post_outbox
 set state='cancelled',updated_at=clock_timestamp()
 where listing_id=p_listing_id and state in ('pending','failed');
 get diagnostics v_changed=row_count;
 return v_changed=1;
end $$;
revoke all on all functions in schema matchmaker_internal from public,anon,authenticated;
grant execute on all functions in schema matchmaker_internal to service_role;
commit;
-- This SQL has no live Discord integration, no publishing, and no automatic
-- reconciliation of 'uncertain' rows. A production endpoint requires release review.
