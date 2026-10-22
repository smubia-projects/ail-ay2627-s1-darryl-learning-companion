-- LearningCompanion schema for Neon Postgres.
--
-- Applied automatically and idempotently on every API start (server/src/db.ts), inside one
-- transaction guarded by an advisory lock. Every statement must be safe to re-run:
-- `create ... if not exists`, `create or replace function`, `create or replace trigger`.
--
-- Ported from the original supabase/migrations (final state of all 18 files) with the
-- Supabase-only parts removed: no auth.users, RLS policies, anon/authenticated/service_role
-- grants or auth.uid(). Learners are anonymous visitors identified by a random UUID the
-- browser keeps in localStorage; the API filters every learner-owned query by that owner ID.
-- Full-text ranking uses tsvector; no pgvector is needed.

create schema if not exists app_private;

create table if not exists public.profiles (
  user_id uuid primary key,
  interests text[] not null default '{}',
  experience_level text not null default 'new' check (experience_level in ('new','some','experienced')),
  onboarding_complete boolean not null default false,
  diagnostic_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(diagnostic_evidence) = 'array'),
  timezone text not null default 'Asia/Singapore',
  reduced_motion boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_interest_choices check (
    cardinality(interests) <= 10 and interests <@ array[
      'web_communication', 'apis', 'databases', 'cloud', 'cybersecurity',
      'web_development', 'ai_ml', 'data_science', 'mobile', 'game_development',
      'devops', 'ui_ux', 'hardware_iot', 'operating_systems'
    ]::text[]
  ),
  constraint profile_diagnostic_bound check (jsonb_array_length(diagnostic_evidence) <= 5)
);

create table if not exists public.concepts (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(title) between 1 and 120),
  normalized_title text generated always as (lower(btrim(title))) stored,
  area text not null check (area in ('web_communication','apis','databases','other')),
  objectives jsonb not null default '[]'::jsonb check (jsonb_typeof(objectives) = 'array'),
  aliases text[] not null default '{}',
  catalogue_order integer,
  supported boolean not null,
  content_available boolean not null default false,
  owner_id uuid references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalogue_or_private check (
    (supported and owner_id is null and catalogue_order is not null and area <> 'other') or
    (not supported and owner_id is not null and catalogue_order is null
      and (not content_available or area = 'other'))
  )
);
create unique index if not exists concepts_catalogue_slug on public.concepts(slug) where owner_id is null;
create unique index if not exists concepts_catalogue_order on public.concepts(catalogue_order) where owner_id is null;
create unique index if not exists concepts_private_slug on public.concepts(owner_id, slug) where owner_id is not null;
create unique index if not exists concepts_private_normalized_title on public.concepts(owner_id, normalized_title) where owner_id is not null;

create table if not exists public.concept_edges (
  id uuid primary key default gen_random_uuid(),
  from_concept_id uuid not null references public.concepts(id) on delete cascade,
  to_concept_id uuid not null references public.concepts(id) on delete cascade,
  relation_type text not null check (relation_type in ('prerequisite','related')),
  reviewed boolean not null default false,
  owner_id uuid references public.profiles(user_id) on delete cascade,
  supporting_source_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  check (from_concept_id <> to_concept_id),
  check ((reviewed and owner_id is null) or (not reviewed and owner_id is not null)),
  unique (from_concept_id, to_concept_id, relation_type, owner_id)
);
create unique index if not exists concept_edges_reviewed_unique on public.concept_edges(from_concept_id,to_concept_id,relation_type) where owner_id is null;
create index if not exists concept_edges_owner_idx on public.concept_edges(owner_id);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null unique,
  title text not null,
  host text not null,
  permission_review text not null default 'pending' check (permission_review in ('pending','allowed','rejected')),
  status text not null default 'draft' check (status in ('draft','approved','rejected')),
  active_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.source_revisions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  content_hash text not null,
  source_version text,
  fetched_at timestamptz not null default now(),
  review_state text not null default 'pending' check (review_state in ('pending','approved','rejected')),
  reviewed_at timestamptz,
  storage_path text,
  unique(source_id, content_hash),
  unique(source_id, id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'active_revision_belongs_to_source') then
    alter table public.sources add constraint active_revision_belongs_to_source
      foreign key (id, active_revision_id) references public.source_revisions(source_id, id);
  end if;
end $$;
create table if not exists public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.source_revisions(id) on delete cascade,
  heading text not null default '',
  ordinal integer not null check (ordinal >= 0),
  body text not null check (length(body) between 1 and 100000),
  search_document tsvector generated always as
    (setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
     setweight(to_tsvector('english', coalesce(body, '')), 'B')) stored,
  unique(revision_id, ordinal)
);
create index if not exists source_chunks_search_idx on public.source_chunks using gin (search_document);
create table if not exists public.source_concepts (
  source_id uuid not null references public.sources(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  primary key(source_id, concept_id)
);
create table if not exists public.chunk_concepts (
  chunk_id uuid not null references public.source_chunks(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  objective_id text not null default '',
  primary key(chunk_id, concept_id, objective_id)
);
create index if not exists chunk_concepts_objective_idx on public.chunk_concepts(concept_id, objective_id, chunk_id);
create index if not exists source_revisions_approved_idx on public.source_revisions(source_id, id) where review_state='approved';
create index if not exists sources_approved_active_idx on public.sources(id, active_revision_id)
  where status='approved' and permission_review='allowed';

-- Student-owned topic suggestions. Each request commits one complete trio.
create table if not exists public.topic_tree_nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  parent_key text not null check (length(parent_key) between 6 and 160),
  title text not null check (length(btrim(title)) between 3 and 100),
  normalized_title text generated always as (lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))) stored,
  objective text not null check (length(btrim(objective)) between 10 and 240),
  request_id uuid not null,
  slot smallint not null check (slot between 1 and 3),
  created_at timestamptz not null default now(),
  unique (owner_id, normalized_title),
  unique (owner_id, request_id, slot),
  constraint topic_tree_nodes_owner_id_id_unique unique (owner_id, id)
);
create index if not exists topic_tree_nodes_parent on public.topic_tree_nodes(owner_id, parent_key, created_at);

create table if not exists public.lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  concept_id uuid not null references public.concepts(id),
  topic_node_id uuid,
  mode text not null check (mode in ('learn','review','explore')),
  generation_state text not null default 'pending' check (generation_state in ('pending','ready','failed')),
  lesson jsonb,
  source_mode text not null check (source_mode in ('source_grounded','unverified')),
  citation_snapshot jsonb not null default '[]'::jsonb,
  content_version text,
  current_step integer not null default 0 check (current_step >= 0),
  active_question_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, owner_id),
  constraint lesson_sessions_topic_identity check (topic_node_id is null or topic_node_id = concept_id),
  constraint lesson_sessions_owned_topic foreign key (owner_id, topic_node_id)
    references public.topic_tree_nodes(owner_id, id)
);
create index if not exists lesson_sessions_owner_idx on public.lesson_sessions(owner_id, created_at desc);
create unique index if not exists lesson_sessions_one_per_topic on public.lesson_sessions(owner_id, topic_node_id)
  where topic_node_id is not null;
-- Shared lesson cache lookup: newest ready catalogue lesson per concept.
create index if not exists lesson_sessions_shared_cache_idx on public.lesson_sessions(concept_id, created_at desc)
  where generation_state = 'ready' and topic_node_id is null;

create table if not exists public.assessment_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  owner_id uuid not null,
  kind text not null check (kind in ('initial','review','confirmation')),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 3),
  source_mode text not null check (source_mode in ('source_grounded','unverified')),
  assessment_basis text not null check (assessment_basis in ('reviewed_key','ai_generated_key')),
  assisted_question_ids text[] not null default '{}',
  qualifies boolean,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id, owner_id),
  unique(owner_id, session_id, kind),
  foreign key (session_id, owner_id) references public.lesson_sessions(id, owner_id) on delete cascade,
  check (source_mode <> 'unverified' or assessment_basis = 'ai_generated_key'),
  check ((completed_at is null and qualifies is null) or (completed_at is not null and qualifies is not null))
);
create index if not exists assessment_rounds_owner_idx on public.assessment_rounds(owner_id, created_at desc);
create table if not exists app_private.assessment_secrets (
  round_id uuid primary key references public.assessment_rounds(id) on delete cascade,
  answer_keys jsonb not null check (jsonb_typeof(answer_keys) = 'object'),
  explanation_rubric jsonb not null default '{}'::jsonb,
  visual_task_key jsonb not null default '{}'::jsonb,
  feedback_criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(feedback_criteria) = 'object')
);
create table if not exists public.answer_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  round_id uuid not null,
  question_id text not null,
  request_id uuid not null,
  attempt_index integer not null check (attempt_index >= 1),
  answer text not null,
  correct boolean not null,
  assisted boolean not null,
  independent boolean not null,
  objective_ids text[] not null default '{}',
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (round_id, owner_id) references public.assessment_rounds(id, owner_id) on delete cascade,
  unique(round_id, question_id, attempt_index),
  unique(owner_id, round_id, request_id),
  check (independent = (attempt_index = 1 and not assisted))
);
create index if not exists answer_attempts_owner_idx on public.answer_attempts(owner_id, created_at desc);
create table if not exists public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  session_id uuid not null,
  request_id uuid not null,
  sequence_no integer not null check (sequence_no >= 0),
  role text not null check (role in ('user','assistant')),
  body text not null,
  citation_chunk_ids uuid[] not null default '{}',
  source_mode text not null check (source_mode in ('source_grounded','unverified')),
  highlight_node_ids text[] not null default '{}',
  highlight_edge_ids text[] not null default '{}',
  selected_text text check (selected_text is null or length(selected_text) between 1 and 2000),
  step_id text,
  created_at timestamptz not null default now(),
  foreign key (session_id, owner_id) references public.lesson_sessions(id, owner_id) on delete cascade,
  unique(session_id, sequence_no),
  unique(owner_id, session_id, request_id, role)
);
create index if not exists tutor_messages_owner_idx on public.tutor_messages(owner_id, created_at desc);
create table if not exists public.user_concept_progress (
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  learning_status text not null default 'not_assessed' check (learning_status in ('not_assessed','explored','developing','demonstrated_understanding')),
  latest_completed_round_id uuid references public.assessment_rounds(id),
  last_explored_at timestamptz,
  last_reviewed_at timestamptz,
  completed_check_count integer not null default 0 check (completed_check_count >= 0),
  updated_at timestamptz not null default now(),
  primary key(owner_id, concept_id)
);
create table if not exists app_private.operation_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  operation_kind text not null,
  request_id uuid not null,
  input_hash text not null,
  state text not null check (state in ('pending','completed','failed','uncertain')),
  usage_metadata jsonb not null default '{}'::jsonb,
  result_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, operation_kind, request_id)
);
-- Deployment-wide daily AI call counters (a cost backstop beneath the per-IP rate limiter).
create table if not exists app_private.ai_usage_days (
  day date not null,
  scope_key text not null,
  call_count integer not null default 0 check (call_count >= 0),
  primary key(day, scope_key)
);
create table if not exists app_private.operation_results (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique references app_private.operation_requests(id) on delete cascade,
  validated_payload jsonb not null,
  created_at timestamptz not null default now()
);
-- Private, immutable snapshots of automatically checked web passages.
create table if not exists app_private.discovered_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  node_id uuid not null,
  canonical_url text not null,
  title text not null,
  content_hash text not null,
  extracted_text text not null check (length(extracted_text) between 1 and 100000),
  fetched_at timestamptz not null default now(),
  unique (owner_id, node_id, canonical_url),
  foreign key (owner_id, node_id) references public.topic_tree_nodes(owner_id, id) on delete cascade
);
create table if not exists app_private.discovered_source_chunks (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references app_private.discovered_source_snapshots(id) on delete cascade,
  heading text not null,
  ordinal integer not null check (ordinal >= 0),
  body text not null check (length(body) between 1 and 12000),
  unique (snapshot_id, ordinal)
);
create index if not exists discovered_source_snapshots_owner_node on app_private.discovered_source_snapshots(owner_id, node_id);

-- Enforce private graph ownership.
create or replace function app_private.validate_concept_edge() returns trigger
language plpgsql set search_path = '' as $$
declare v_from_owner uuid; v_to_owner uuid;
begin
  select owner_id into v_from_owner from public.concepts where id = new.from_concept_id;
  select owner_id into v_to_owner from public.concepts where id = new.to_concept_id;
  if new.owner_id is null then
    if v_from_owner is not null or v_to_owner is not null then
      raise exception 'Reviewed edges must connect catalogue concepts.';
    end if;
  elsif (v_from_owner is not null and v_from_owner <> new.owner_id)
     or (v_to_owner is not null and v_to_owner <> new.owner_id) then
    raise exception 'A private edge cannot reference another learner''s concept.';
  end if;
  return new;
end;
$$;
create or replace trigger concept_edge_access before insert or update on public.concept_edges
  for each row execute function app_private.validate_concept_edge();

-- Round snapshots are immutable once issued.
create or replace function app_private.validate_assessment_round() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_question jsonb;
  v_ids text[] := '{}';
  v_families text[] := '{}';
  v_option jsonb;
  v_option_ids text[];
  v_application_count integer := 0;
  v_session_source_mode text;
begin
  if tg_op = 'UPDATE' then
    if new.questions is distinct from old.questions or new.session_id is distinct from old.session_id
       or new.owner_id is distinct from old.owner_id or new.source_mode is distinct from old.source_mode
       or new.assessment_basis is distinct from old.assessment_basis or new.kind is distinct from old.kind then
      raise exception 'Assessment round identity and questions are immutable.';
    end if;
    return new;
  end if;
  select source_mode into v_session_source_mode from public.lesson_sessions
    where id = new.session_id and owner_id = new.owner_id;
  if v_session_source_mode is null or v_session_source_mode <> new.source_mode then
    raise exception 'Assessment source mode must match its session.';
  end if;
  for v_question in select value from jsonb_array_elements(new.questions) loop
    if coalesce(v_question->>'id','') = '' or coalesce(v_question->>'familyId','') = ''
       or v_question->>'kind' not in ('recall','application')
       or jsonb_typeof(v_question->'options') is distinct from 'array'
       or jsonb_typeof(v_question->'objectiveIds') is distinct from 'array'
       or jsonb_array_length(v_question->'objectiveIds') < 1
       or jsonb_array_length(v_question->'options') not between 2 and 6 then
      raise exception 'Assessment question structure is invalid.';
    end if;
    if (v_question->>'id') = any(v_ids) or (v_question->>'familyId') = any(v_families) then
      raise exception 'Assessment question IDs and families must be distinct.';
    end if;
    v_ids := array_append(v_ids, v_question->>'id');
    v_families := array_append(v_families, v_question->>'familyId');
    if v_question->>'kind' = 'application' then v_application_count := v_application_count + 1; end if;
    v_option_ids := '{}';
    for v_option in select value from jsonb_array_elements(v_question->'options') loop
      if coalesce(v_option->>'id','') = '' or (v_option->>'id') = any(v_option_ids) then
        raise exception 'Assessment option IDs must be non-empty and distinct.';
      end if;
      v_option_ids := array_append(v_option_ids, v_option->>'id');
    end loop;
  end loop;
  if v_application_count = 0 then raise exception 'Assessment requires an application question.'; end if;
  return new;
end;
$$;
create or replace trigger assessment_round_structure before insert or update on public.assessment_rounds
  for each row execute function app_private.validate_assessment_round();

-- Public question JSON must have the same allowlist as the shared DTO, so answer keys or
-- private feedback criteria can never be persisted in a learner-readable round.
create or replace function app_private.validate_public_questions() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_question jsonb;
  v_option jsonb;
  v_field text;
begin
  for v_question in select value from jsonb_array_elements(new.questions) loop
    if jsonb_typeof(v_question) <> 'object' then
      raise exception 'Public question must be an object.';
    end if;
    for v_field in select key from jsonb_object_keys(v_question) as key loop
      if v_field not in ('id','familyId','prompt','kind','objectiveIds','citationChunkIds','options') then
        raise exception 'Public question contains a non-public field.';
      end if;
    end loop;
    if not (v_question ?& array['id','familyId','prompt','kind','objectiveIds','citationChunkIds','options']) then
      raise exception 'Public question is missing a required field.';
    end if;
    for v_option in select value from jsonb_array_elements(v_question->'options') loop
      if jsonb_typeof(v_option) <> 'object' or
         (select array_agg(key order by key) from jsonb_object_keys(v_option) as key)
           is distinct from array['id','text']::text[] then
        raise exception 'Public option contains a non-public field.';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;
create or replace trigger assessment_round_public_question_guard before insert or update on public.assessment_rounds
  for each row execute function app_private.validate_public_questions();

create or replace function app_private.validate_assessment_keys() returns trigger
language plpgsql set search_path = '' as $$
declare v_questions jsonb; v_question jsonb;
begin
  select questions into v_questions from public.assessment_rounds where id = new.round_id;
  if v_questions is null or (select count(*) from jsonb_object_keys(new.answer_keys)) <> 3 then
    raise exception 'Exactly three answer keys are required.';
  end if;
  for v_question in select value from jsonb_array_elements(v_questions) loop
    if not exists (select 1 from jsonb_array_elements(v_question->'options')
      where value->>'id' = new.answer_keys->>(v_question->>'id')) then
      raise exception 'Answer key must match a public option for every question.';
    end if;
  end loop;
  return new;
end;
$$;
create or replace trigger assessment_keys_match_round before insert or update on app_private.assessment_secrets
  for each row execute function app_private.validate_assessment_keys();

create or replace function app_private.protect_assessment_keys() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.answer_keys is distinct from old.answer_keys or
     new.feedback_criteria is distinct from old.feedback_criteria or
     new.round_id is distinct from old.round_id then
    raise exception 'Issued assessment keys and feedback criteria are immutable.';
  end if;
  return new;
end;
$$;
create or replace trigger assessment_keys_immutable before update on app_private.assessment_secrets
  for each row execute function app_private.protect_assessment_keys();

-- Explanations may improve in place; diagram, source and assessment context stays frozen.
create or replace function app_private.protect_lesson_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.generation_state = 'ready' and (
    new.generation_state is distinct from old.generation_state or
    new.mode is distinct from old.mode or
    new.citation_snapshot is distinct from old.citation_snapshot or
    new.content_version is distinct from old.content_version or
    new.source_mode is distinct from old.source_mode or
    new.concept_id is distinct from old.concept_id or
    new.owner_id is distinct from old.owner_id or
    (new.lesson - 'steps') is distinct from (old.lesson - 'steps') or
    jsonb_typeof(new.lesson->'steps') is distinct from 'array' or
    (select jsonb_agg(value - array['caption','explanation','workedExample','commonMistake'] order by ordinality)
      from jsonb_array_elements(new.lesson->'steps') with ordinality) is distinct from
    (select jsonb_agg(value - array['caption','explanation','workedExample','commonMistake'] order by ordinality)
      from jsonb_array_elements(old.lesson->'steps') with ordinality) or
    exists (select 1 from jsonb_array_elements(new.lesson->'steps') as step
      cross join unnest(array['caption','explanation','workedExample','commonMistake']) as field
      where jsonb_typeof(step->field) is distinct from 'string')
  ) then
    raise exception 'Issued lesson context is immutable; only explanation text may change.';
  end if;
  return new;
end;
$$;
create or replace trigger lesson_snapshot_immutable before update on public.lesson_sessions
  for each row execute function app_private.protect_lesson_snapshot();

-- A completed check completes its lesson session in the same transaction.
create or replace function app_private.complete_lesson_after_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.completed_at is null and new.completed_at is not null then
    update public.lesson_sessions set completed_at = new.completed_at
      where id = new.session_id and owner_id = new.owner_id and completed_at is null;
  end if;
  return new;
end;
$$;
create or replace trigger assessment_round_completes_lesson
  after update of completed_at on public.assessment_rounds
  for each row execute function app_private.complete_lesson_after_check();

-- A ready lesson is learning activity even before its first quiz answer.
create or replace function app_private.mark_lesson_explored() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.generation_state = 'ready' and new.lesson is not null then
    insert into public.user_concept_progress (owner_id, concept_id, learning_status, last_explored_at)
      values (new.owner_id, new.concept_id, 'explored', new.created_at)
    on conflict (owner_id, concept_id) do update set
      learning_status = case when public.user_concept_progress.learning_status = 'not_assessed'
        then 'explored' else public.user_concept_progress.learning_status end,
      last_explored_at = greatest(public.user_concept_progress.last_explored_at, excluded.last_explored_at),
      updated_at = now();
  end if;
  return new;
end;
$$;
create or replace trigger lesson_session_explored
  after insert or update of generation_state on public.lesson_sessions
  for each row execute function app_private.mark_lesson_explored();

-- Rank approved reference chunks for a catalogue concept's objectives.
create or replace function public.find_approved_lesson_passages(p_concept_id uuid, p_objective_ids text[], p_query text)
returns table(id uuid, heading text, body text, source_url text, objective_id text, rank real)
language sql stable set search_path = '' as $$
  select ch.id, ch.heading, ch.body, s.canonical_url, cc.objective_id,
    ts_rank(ch.search_document, plainto_tsquery('english', left(p_query, 200))) as rank
  from public.chunk_concepts cc
  join public.source_chunks ch on ch.id=cc.chunk_id
  join public.source_revisions r on r.id=ch.revision_id and r.review_state='approved'
  join public.sources s on s.id=r.source_id and s.active_revision_id=r.id
    and s.status='approved' and s.permission_review='allowed'
  where cc.concept_id=p_concept_id and cc.objective_id=any(p_objective_ids)
  order by rank desc, s.canonical_url, ch.ordinal
  limit 40;
$$;

create or replace function public.available_lesson_concepts() returns setof uuid
language sql stable set search_path = '' as $$
  select c.id from public.concepts c
  where c.supported and c.owner_id is null
    and c.catalogue_order in (1,2,5,9)
    and jsonb_array_length(c.objectives) > 0
    and not exists (
      select 1 from jsonb_array_elements(c.objectives) objective
      where not exists (
        select 1 from public.chunk_concepts cc
        join public.source_chunks ch on ch.id=cc.chunk_id
        join public.source_revisions r on r.id=ch.revision_id and r.review_state='approved'
        join public.sources s on s.id=r.source_id and s.active_revision_id=r.id
          and s.status='approved' and s.permission_review='allowed'
        where cc.concept_id=c.id and cc.objective_id=objective->>'id'
      )
    );
$$;

-- A hint records assistance before returning guidance. Replays change no evidence.
-- p_owner is the anonymous visitor ID the API resolved (replaces Supabase auth.uid()).
create or replace function public.request_mcq_hint(p_owner uuid, p_round_id uuid, p_question_id text, p_request_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_owner uuid := p_owner;
  v_round record;
  v_question jsonb;
  v_step jsonb;
  v_hint text;
begin
  if v_owner is null then raise exception 'Owner required.' using errcode = '28000'; end if;
  if p_question_id is null or length(p_question_id) > 100 or p_request_id is null then
    raise exception 'Invalid hint request.' using errcode = '22023';
  end if;
  select r.*, s.lesson into v_round from public.assessment_rounds r
    join public.lesson_sessions s on s.id = r.session_id and s.owner_id = r.owner_id
    where r.id = p_round_id and r.owner_id = v_owner for update of r;
  if not found then raise exception 'Round not found.' using errcode = '02000'; end if;
  select value into v_question from jsonb_array_elements(v_round.questions)
    where value->>'id' = p_question_id;
  if v_question is null then raise exception 'Question not found.' using errcode = '22023'; end if;
  if not p_question_id = any(v_round.assisted_question_ids) then
    update public.assessment_rounds set assisted_question_ids = array_append(assisted_question_ids, p_question_id)
      where id = p_round_id;
  end if;
  select value into v_step from jsonb_array_elements(coalesce(v_round.lesson->'steps','[]'::jsonb))
    where (value->'citationChunkIds') ?| array(select jsonb_array_elements_text(v_question->'citationChunkIds'))
    limit 1;
  v_hint := case when v_step is null then 'Review the lesson example and the sources for this question before choosing.'
    else format('Review the "%s" step and its worked example, then compare the choices.', v_step->>'heading') end;
  return jsonb_build_object('hint', v_hint, 'assisted', true);
end;
$$;

-- Grades an MCQ answer from server-only keys and commits evidence plus its progress
-- projection in one transaction. Practice retries keep the first answer and never revise
-- a completed result. p_owner is the anonymous visitor ID resolved by the API.
create or replace function public.submit_mcq_answer(
  p_owner uuid, p_round_id uuid, p_question_id text, p_answer text, p_request_id uuid
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_owner uuid := p_owner;
  v_round record;
  v_existing public.answer_attempts%rowtype;
  v_question jsonb;
  v_keys jsonb;
  v_correct boolean;
  v_assisted boolean;
  v_attempt_index integer;
  v_latest_correct boolean;
  v_attempt_id uuid;
  v_answered integer;
  v_qualifies boolean;
  v_previous text;
  v_current text;
  v_completed boolean := false;
  v_response jsonb;
  v_progress_update jsonb;
begin
  if v_owner is null then raise exception 'Owner required.' using errcode = '28000'; end if;
  if p_question_id is null or length(p_question_id) > 100 or p_answer is null
     or length(p_answer) > 100 or p_request_id is null then
    raise exception 'Invalid answer request.' using errcode = '22023';
  end if;
  select r.*, s.concept_id into v_round from public.assessment_rounds r
    join public.lesson_sessions s on s.id = r.session_id and s.owner_id = r.owner_id
    where r.id = p_round_id and r.owner_id = v_owner for update of r;
  if not found then raise exception 'Round not found.' using errcode = '02000'; end if;
  select * into v_existing from public.answer_attempts
    where owner_id = v_owner and round_id = p_round_id and request_id = p_request_id;
  if found then
    if v_existing.question_id <> p_question_id or v_existing.answer <> p_answer then
      raise exception 'Request ID was reused with different input.' using errcode = '23505';
    end if;
    return v_existing.response_snapshot;
  end if;
  select value into v_question from jsonb_array_elements(v_round.questions)
    where value->>'id' = p_question_id;
  if v_question is null then raise exception 'Question not found.' using errcode = '22023'; end if;
  if not exists(select 1 from jsonb_array_elements(v_question->'options')
    where value->>'id' = p_answer) then
    raise exception 'Answer option not found.' using errcode = '22023';
  end if;
  select coalesce(max(attempt_index),0)+1 into v_attempt_index from public.answer_attempts
    where round_id = p_round_id and question_id = p_question_id;
  if v_attempt_index = 1 and v_round.completed_at is not null then
    raise exception 'Round is already completed.' using errcode = '23514';
  end if;
  if v_attempt_index > 1 then
    select correct into v_latest_correct from public.answer_attempts
      where round_id = p_round_id and question_id = p_question_id
      order by attempt_index desc limit 1;
    if v_latest_correct then raise exception 'Answer is already correct.' using errcode = '23514'; end if;
  end if;
  select answer_keys into v_keys from app_private.assessment_secrets where round_id = p_round_id;
  if v_keys is null or v_keys->>p_question_id is null then
    raise exception 'Assessment key is unavailable.' using errcode = '23514';
  end if;
  v_correct := (v_keys->>p_question_id = p_answer);
  v_assisted := v_attempt_index > 1 or p_question_id = any(v_round.assisted_question_ids);
  insert into public.answer_attempts (
    owner_id, round_id, question_id, request_id, attempt_index, answer,
    correct, assisted, independent, objective_ids
  ) values (
    v_owner, p_round_id, p_question_id, p_request_id, v_attempt_index, p_answer,
    v_correct, v_assisted, v_attempt_index = 1 and not v_assisted,
    array(select jsonb_array_elements_text(v_question->'objectiveIds'))
  ) returning id into v_attempt_id;
  if v_attempt_index = 1 then
    select count(*) into v_answered from public.answer_attempts where round_id = p_round_id and attempt_index = 1;
    if v_answered = 3 then
      select count(*) = 3 and bool_and(correct and independent) into v_qualifies
        from public.answer_attempts where round_id = p_round_id and attempt_index = 1;
      v_current := case when v_qualifies then 'demonstrated_understanding' else 'developing' end;
      insert into public.user_concept_progress (owner_id, concept_id, learning_status)
        values (v_owner, v_round.concept_id, 'developing') on conflict do nothing;
      select learning_status into v_previous from public.user_concept_progress
        where owner_id = v_owner and concept_id = v_round.concept_id for update;
      update public.assessment_rounds set completed_at = now(), qualifies = v_qualifies
        where id = p_round_id;
      update public.user_concept_progress set learning_status = v_current,
        latest_completed_round_id = p_round_id,
        completed_check_count = completed_check_count + 1,
        last_reviewed_at = case when v_round.kind = 'review' then now() else last_reviewed_at end,
        updated_at = now()
        where owner_id = v_owner and concept_id = v_round.concept_id;
      v_completed := true;
      v_progress_update := jsonb_build_object(
        'conceptId', v_round.concept_id, 'previousStatus', v_previous,
        'currentStatus', v_current, 'changed', v_previous <> v_current,
        'evidenceRoundId', p_round_id, 'sourceMode', v_round.source_mode,
        'assessmentBasis', v_round.assessment_basis
      );
    else
      insert into public.user_concept_progress (owner_id, concept_id, learning_status)
        values (v_owner, v_round.concept_id, 'developing') on conflict do nothing;
    end if;
  end if;
  v_response := jsonb_build_object(
    'evidence', jsonb_build_object(
      'id', v_attempt_id, 'roundId', p_round_id, 'questionId', p_question_id,
      'requestId', p_request_id, 'attemptIndex', v_attempt_index, 'answer', p_answer,
      'correct', v_correct, 'assisted', v_assisted,
      'independent', v_attempt_index = 1 and not v_assisted,
      'objectiveIds', to_jsonb(array(select jsonb_array_elements_text(v_question->'objectiveIds')))
    ),
    'feedback', case when v_correct then 'Correct.' else 'Not quite. Try another choice or ask for a hint.' end,
    'completed', v_completed
  );
  if v_completed then v_response := v_response || jsonb_build_object('progressUpdate', v_progress_update); end if;
  update public.answer_attempts set response_snapshot = v_response where id = v_attempt_id;
  return v_response;
end;
$$;
