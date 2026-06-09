-- ============================================================
-- ICGG / Reaccion en Cadena - Church Document & E-Sign Platform
-- Multi-tenant | RLS | single-signer v1 | AI categorization
-- ============================================================

-- ---------- ORGANIZATIONS (tenants + ministries + external churches) ----------
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  type          text not null default 'church'
                check (type in ('church','ministry','external_covering')),
  parent_org_id uuid references organizations(id) on delete cascade,
  status        text not null default 'active'
                check (status in ('active','pending','suspended')),
  logo_url      text,
  default_lang  text not null default 'es' check (default_lang in ('es','en')),
  created_at    timestamptz not null default now()
);

-- ---------- COVERING relationships ----------
create table org_coverings (
  id               uuid primary key default gen_random_uuid(),
  external_org_id  uuid not null references organizations(id) on delete cascade,
  covering_org_id  uuid not null references organizations(id) on delete cascade,
  covering_pastor  text not null default 'Pastora Irene Familia',
  status           text not null default 'pending'
                   check (status in ('pending','agreement_sent','active','ended')),
  agreement_doc_id uuid,
  created_at       timestamptz not null default now()
);

-- ---------- MEMBERS (who can log in) ----------
create table org_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  role       text not null default 'secretary'
             check (role in ('super_admin','org_admin','secretary','viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);

-- ---------- DOCUMENT TEMPLATES ----------
create table document_templates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  ministry_id    uuid references organizations(id) on delete set null,
  name           text not null,
  category       text not null default 'other'
                 check (category in ('membership','baptism','child_dedication',
                        'covering','volunteer','financial','other')),
  ai_suggested   boolean not null default false,
  ai_confidence  numeric,
  source_pdf_url text not null,
  page_count     int not null default 1,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

create table template_fields (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references document_templates(id) on delete cascade,
  field_type  text not null
              check (field_type in ('signature','initials','text','date','checkbox','dropdown')),
  label       text not null,
  page        int not null default 1,
  x numeric not null, y numeric not null, width numeric not null, height numeric not null,
  required    boolean not null default true,
  options     jsonb,
  sort_order  int not null default 0
);

-- ---------- DOCUMENTS (one sent instance per signer) ----------
create table documents (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  ministry_id    uuid references organizations(id) on delete set null,
  template_id    uuid references document_templates(id) on delete set null,
  category       text not null default 'other',
  title          text not null,
  status         text not null default 'draft'
                 check (status in ('draft','sent','delivered','viewed','signed','declined','voided')),
  signer_name    text not null,
  signer_email   text not null,
  access_pin_hash text,
  lang           text not null default 'es' check (lang in ('es','en')),
  signing_token  uuid not null default gen_random_uuid(),
  reminder_days  int default 3,
  expires_at     timestamptz,
  source_pdf_url text not null,
  signed_pdf_url text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  signed_at      timestamptz
);
create unique index documents_signing_token_idx on documents(signing_token);

alter table org_coverings
  add constraint fk_agreement_doc
  foreign key (agreement_doc_id) references documents(id) on delete set null;

create table document_fields (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  field_type  text not null,
  label       text not null,
  page        int not null default 1,
  x numeric not null, y numeric not null, width numeric not null, height numeric not null,
  required    boolean not null default true,
  options     jsonb,
  value       text,
  filled_at   timestamptz
);

-- ---------- AUDIT TRAIL ----------
create table audit_events (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  event_type  text not null
              check (event_type in ('created','sent','delivered','opened',
                     'field_filled','signed','declined','voided','reminded')),
  actor       text,
  ip_address  inet,
  user_agent  text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- HELPER: org ids the current user can access (incl. child ministries)
-- ============================================================
create or replace function my_org_ids()
returns setof uuid language sql security definer stable as $$
  select org_id from org_members where user_id = auth.uid()
  union
  select o.id from organizations o
    join org_members m on m.org_id = o.parent_org_id
   where m.user_id = auth.uid();
$$;

-- ============================================================
-- TRIGGER: activate covering when its agreement is signed
-- ============================================================
create or replace function activate_covering_on_sign()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'signed' and (old.status is distinct from 'signed') then
    update org_coverings
       set status = 'active'
     where agreement_doc_id = new.id
       and status <> 'active';
  end if;
  return new;
end;
$$;

create trigger trg_activate_covering
  after update on documents
  for each row execute function activate_covering_on_sign();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table organizations     enable row level security;
alter table org_coverings      enable row level security;
alter table org_members        enable row level security;
alter table document_templates enable row level security;
alter table template_fields    enable row level security;
alter table documents          enable row level security;
alter table document_fields    enable row level security;
alter table audit_events       enable row level security;

create policy orgs_read on organizations
  for select using (id in (select my_org_ids()) or parent_org_id in (select my_org_ids()));
create policy orgs_write on organizations
  for all using (id in (select my_org_ids()) or parent_org_id in (select my_org_ids()))
  with check (id in (select my_org_ids()) or parent_org_id in (select my_org_ids()));

create policy members_self on org_members
  for select using (user_id = auth.uid());

create policy coverings_iso on org_coverings
  for all using (covering_org_id in (select my_org_ids()))
  with check (covering_org_id in (select my_org_ids()));

create policy templates_iso on document_templates
  for all using (org_id in (select my_org_ids()))
  with check (org_id in (select my_org_ids()));

create policy template_fields_iso on template_fields
  for all using (template_id in (select id from document_templates where org_id in (select my_org_ids())))
  with check (template_id in (select id from document_templates where org_id in (select my_org_ids())));

create policy documents_iso on documents
  for all using (org_id in (select my_org_ids()))
  with check (org_id in (select my_org_ids()));

create policy document_fields_iso on document_fields
  for all using (document_id in (select id from documents where org_id in (select my_org_ids())))
  with check (document_id in (select id from documents where org_id in (select my_org_ids())));

create policy audit_iso on audit_events
  for select using (document_id in (select id from documents where org_id in (select my_org_ids())));

-- NOTE: the public signing page never uses these policies. It hits the
-- sign-document Edge Function (service role), which validates signing_token
-- + PIN server-side. Signers get zero direct table access.

-- ============================================================
-- STORAGE: private bucket for source + signed PDFs
-- ============================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Staff can read files for their orgs; path = {org_id}/{category}/{signer}/...
create policy "staff read org files" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]::uuid in (select my_org_ids())
  );
create policy "staff upload org files" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]::uuid in (select my_org_ids())
  );

-- ============================================================
-- SEED: ICGG, Reaccion en Cadena, sample ministries
-- ============================================================
insert into organizations (name, slug, type, default_lang) values
  ('Iglesia Cristiana Gracia y Gloria', 'icgg', 'church', 'es'),
  ('Reaccion en Cadena Ministries', 'reaccion-en-cadena', 'church', 'es');

insert into organizations (name, slug, type, parent_org_id, default_lang)
select m.name, m.slug, 'ministry', o.id, 'es'
from (values
  ('Jovenes (Youth)', 'icgg-youth'),
  ('Alabanza (Worship)', 'icgg-worship'),
  ('Ninos (Children)', 'icgg-children'),
  ('Alcance (Outreach)', 'icgg-outreach')
) as m(name, slug)
cross join (select id from organizations where slug='icgg') o;
