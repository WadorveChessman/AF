-- ============================================================
-- AYIFIN v4 — Schéma complet multi-entreprise (Supabase / PostgreSQL)
-- Développé par ING. Worvensky-Wadson PIERRE
-- ⚠️ Ce script SUPPRIME les anciennes tables AYIFIN puis les recrée.
-- Exécuter en entier dans Supabase → SQL Editor → New query → Run
-- ============================================================
create extension if not exists pgcrypto;

-- ============================================================
-- 0. NETTOYAGE
-- ============================================================
drop table if exists audit_log, notifications, garanties, paiements_pret, echeances, transactions,
  prets, retraits, depots, comptes, clients, types_pret, types_compte, users, entreprises cascade;
drop sequence if exists seq_compte, seq_pret;
drop function if exists current_entreprise_id();
drop policy if exists logo_read on storage.objects;
drop policy if exists logo_write on storage.objects;
drop policy if exists logo_update on storage.objects;
drop policy if exists logos_read on storage.objects;
drop policy if exists logos_ins on storage.objects;
drop policy if exists logos_upd on storage.objects;
drop policy if exists avatars_ins on storage.objects;
drop policy if exists avatars_upd on storage.objects;

create sequence seq_compte;
create sequence seq_pret;

-- ============================================================
-- 1. TABLES
-- ============================================================
create table entreprises (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  slogan text, adresse text, telephone text, email text,
  devise text not null default 'HTG' check (devise in ('HTG','USD','EUR')),
  logo_url text,
  couleur text default '#0b1f4b',
  actif boolean not null default true,
  plan text not null default 'STANDARD',
  max_users int not null default 10 check (max_users >= 1),
  date_contrat_debut date default current_date,
  date_contrat_fin date,
  notes text,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  entreprise_id uuid references entreprises(id) on delete cascade,
  username text not null,
  nom_complet text,
  email text,
  telephone text,
  avatar_url text,
  role text not null default 'AGENT' check (role in ('SUPERADMIN','ADMIN','AGENT','CAISSIER')),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  constraint users_role_ent check ((role='SUPERADMIN' and entreprise_id is null) or (role<>'SUPERADMIN' and entreprise_id is not null))
);

create table types_compte (
  id serial primary key,
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  nom text not null,
  taux numeric(5,2) not null default 0,
  depot_min numeric(14,2) not null default 0,
  frais_ouv numeric(14,2) not null default 0,
  frais_mens numeric(14,2) not null default 0,
  actif boolean not null default true
);

create table types_pret (
  id serial primary key,
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  nom text not null,
  taux_mensuel numeric(5,2) not null default 1.00 check (taux_mensuel > 0),
  duree_max int not null default 12 check (duree_max >= 1),
  montant_min numeric(14,2) not null default 1000,
  montant_max numeric(14,2) not null default 50000,
  frais numeric(14,2) not null default 0,
  actif boolean not null default true
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  nom_complet text not null,
  nif_cin text not null,
  telephone text not null,
  email text, adresse text, ville text,
  date_naissance date,
  sexe text default 'N',
  profession text,
  created_at timestamptz not null default now(),
  unique(entreprise_id, nif_cin),
  unique(entreprise_id, telephone)
);

create table comptes (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  type_compte_id int references types_compte(id),
  numero_compte_interne text not null,
  solde numeric(14,2) not null default 0 check (solde >= 0),
  date_ouverture date default current_date,
  statut text not null default 'ACTIF' check (statut in ('ACTIF','SUSPENDU','FERME')),
  created_at timestamptz not null default now(),
  unique(entreprise_id, numero_compte_interne)
);

create table depots (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  compte_id uuid not null references comptes(id) on delete restrict,
  montant numeric(14,2) not null check (montant > 0),
  date_operation date default current_date,
  description text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table retraits (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  compte_id uuid not null references comptes(id) on delete restrict,
  montant numeric(14,2) not null check (montant > 0),
  date_operation date default current_date,
  description text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table prets (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  compte_id uuid references comptes(id),
  type_pret_id int references types_pret(id),
  numero_pret text not null,
  montant numeric(14,2) not null check (montant > 0),
  taux_interet_mensuel numeric(5,2) not null,
  duree_mois int not null check (duree_mois >= 1),
  date_debut date not null,
  date_fin date not null,
  montant_interet numeric(14,2) not null,
  montant_total numeric(14,2) not null,
  mensualite numeric(14,2) not null,
  frais_dossier numeric(14,2) not null default 0,
  solde_restant numeric(14,2) not null,
  statut text not null default 'DEMANDE' check (statut in ('DEMANDE','APPROUVE','EN_COURS','RETARD','REMBOURSE','REJETE')),
  motif_rejet text,
  date_approbation timestamptz,
  date_decaissement date,
  approved_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique(entreprise_id, numero_pret)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  compte_id uuid references comptes(id) on delete restrict,
  pret_id uuid references prets(id) on delete cascade,
  type_transaction text not null,
  montant numeric(14,2) not null,
  description text,
  date_transaction timestamptz not null default now(),
  created_by uuid references users(id)
);

create table echeances (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  pret_id uuid not null references prets(id) on delete cascade,
  numero_echeance int not null,
  date_echeance date not null,
  montant_echeance numeric(14,2) not null,
  capital numeric(14,2) not null,
  interet numeric(14,2) not null,
  solde_restant numeric(14,2) not null,
  statut text not null default 'EN_ATTENTE' check (statut in ('EN_ATTENTE','PAYE','RETARD')),
  date_paiement date
);

create table paiements_pret (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  pret_id uuid not null references prets(id) on delete cascade,
  date_paiement date not null,
  montant numeric(14,2) not null check (montant > 0),
  capital_rembourse numeric(14,2) not null default 0,
  interet_paye numeric(14,2) not null default 0,
  description text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table garanties (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  pret_id uuid not null references prets(id) on delete cascade,
  type text default 'EPARGNE',
  description text,
  valeur numeric(14,2) default 0,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  destinataire_id uuid references users(id) on delete cascade, -- NULL = tous les ADMIN de l'entreprise
  auteur_id uuid,
  auteur_nom text,
  type text,
  message text not null,
  ref_table text,
  ref_id uuid,
  lu boolean not null default false,
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid,
  user_id uuid,
  username text,
  action text not null,
  table_name text,
  record_id uuid,
  details text,
  created_at timestamptz not null default now()
);

create index on users(entreprise_id);
create index on clients(entreprise_id);
create index on comptes(entreprise_id, client_id);
create index on depots(entreprise_id, compte_id);
create index on retraits(entreprise_id, compte_id);
create index on transactions(entreprise_id, compte_id);
create index on prets(entreprise_id, client_id, statut);
create index on echeances(entreprise_id, pret_id, statut);
create index on paiements_pret(entreprise_id, pret_id);
create index on notifications(entreprise_id, created_at desc);
create index on audit_log(entreprise_id, created_at desc);

-- ============================================================
-- 2. FONCTIONS UTILITAIRES (sécurité)
-- ============================================================
create or replace function my_role() returns text language sql stable security definer set search_path=public as $$
  select role from users where id=auth.uid() and actif limit 1 $$;

create or replace function is_superadmin() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select role='SUPERADMIN' and actif from users where id=auth.uid()),false) $$;

-- entreprise de l'utilisateur, sans contrôle d'état (pour afficher le message "suspendu")
create or replace function my_entreprise_raw() returns uuid language sql stable security definer set search_path=public as $$
  select entreprise_id from users where id=auth.uid() $$;

-- entreprise de l'utilisateur SEULEMENT si utilisateur actif + entreprise active + contrat valide
create or replace function my_entreprise_id() returns uuid language sql stable security definer set search_path=public as $$
  select u.entreprise_id from users u join entreprises e on e.id=u.entreprise_id
  where u.id=auth.uid() and u.actif and e.actif and (e.date_contrat_fin is null or e.date_contrat_fin>=current_date)
  limit 1 $$;

create or replace function _need(roles text[]) returns uuid language plpgsql stable security definer set search_path=public as $$
declare r text; e uuid;
begin
  r:=my_role(); e:=my_entreprise_id();
  if r is null then raise exception 'Compte utilisateur désactivé ou inexistant'; end if;
  if e is null then raise exception 'Accès suspendu ou contrat expiré. Contactez le support AYIFIN.'; end if;
  if not (r = any(roles)) then raise exception 'Action non autorisée pour votre rôle (%)', r; end if;
  return e;
end $$;

create or replace function _audit(p_e uuid,p_action text,p_table text,p_rid uuid,p_details text) returns void
language plpgsql security definer set search_path=public as $$
declare u users%rowtype;
begin
  select * into u from users where id=auth.uid();
  insert into audit_log(entreprise_id,user_id,username,action,table_name,record_id,details)
  values(p_e,u.id,coalesce(u.nom_complet,u.username),p_action,p_table,p_rid,p_details);
end $$;

create or replace function _caisse(p_e uuid) returns numeric language sql stable security definer set search_path=public as $$
  select round(
    coalesce((select sum(montant) from depots where entreprise_id=p_e),0)
   -coalesce((select sum(montant) from retraits where entreprise_id=p_e),0)
   -coalesce((select sum(montant-frais_dossier) from prets where entreprise_id=p_e and statut in ('EN_COURS','RETARD','REMBOURSE')),0)
   +coalesce((select sum(montant) from paiements_pret where entreprise_id=p_e),0),2) $$;

-- ============================================================
-- 3. TRIGGERS DE PROTECTION
-- ============================================================
create or replace function trg_ent_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or is_superadmin() then return new; end if;
  new.actif:=old.actif; new.plan:=old.plan; new.max_users:=old.max_users;
  new.date_contrat_debut:=old.date_contrat_debut; new.date_contrat_fin:=old.date_contrat_fin; new.notes:=old.notes;
  return new;
end $$;
create trigger ent_guard before update on entreprises for each row execute function trg_ent_guard();

create or replace function trg_users_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or is_superadmin() then return new; end if;
  new.id:=old.id; new.entreprise_id:=old.entreprise_id; new.email:=old.email;
  if new.role='SUPERADMIN' then new.role:=old.role; end if;
  if old.id=auth.uid() then new.role:=old.role; new.actif:=old.actif; end if;
  return new;
end $$;
create trigger users_guard before update on users for each row execute function trg_users_guard();

create or replace function trg_users_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.actif is distinct from new.actif then
    perform _audit(new.entreprise_id,'users.UPDATE','users',new.id,
      case when new.actif then 'Utilisateur réactivé : ' else 'Utilisateur désactivé : ' end||coalesce(new.nom_complet,new.username));
  end if;
  if old.role is distinct from new.role then
    perform _audit(new.entreprise_id,'users.UPDATE','users',new.id,'Rôle modifié : '||coalesce(new.nom_complet,new.username)||' → '||new.role);
  end if;
  return null;
end $$;
create trigger users_audit after update on users for each row execute function trg_users_audit();

-- Notifications aux ADMIN + journal d'audit sur chaque opération métier
create or replace function trg_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare
  u users%rowtype; j jsonb; o jsonb; ent uuid; rid uuid;
  msg text; typ text; cn text; num text; creator uuid;
begin
  j:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  o:=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  ent:=(j->>'entreprise_id')::uuid; rid:=(j->>'id')::uuid;
  select * into u from users where id=auth.uid();
  if u.id is null or u.role='SUPERADMIN' then return null; end if;

  if TG_TABLE_NAME='clients' then
    typ:='CLIENT';
    msg:=case TG_OP when 'INSERT' then 'Nouveau client enregistré : ' when 'UPDATE' then 'Client modifié : ' else 'Client supprimé : ' end||coalesce(j->>'nom_complet','');

  elsif TG_TABLE_NAME='comptes' then
    typ:='COMPTE';
    if TG_OP='UPDATE' and (o->>'statut') is not distinct from (j->>'statut') then return null; end if;
    select nom_complet into cn from clients where id=(j->>'client_id')::uuid;
    msg:=case when TG_OP='INSERT' then 'Compte ouvert '||(j->>'numero_compte_interne')||' — '||coalesce(cn,'?')
              else 'Compte '||(j->>'numero_compte_interne')||' : statut '||(j->>'statut') end;

  elsif TG_TABLE_NAME in ('depots','retraits') then
    typ:=case when TG_TABLE_NAME='depots' then 'DEPOT' else 'RETRAIT' end;
    if coalesce(j->>'description','') in ('Dépôt initial','Clôture de compte') then return null; end if;
    select c.numero_compte_interne, cl.nom_complet into num, cn
      from comptes c join clients cl on cl.id=c.client_id where c.id=(j->>'compte_id')::uuid;
    msg:=case when typ='DEPOT' then 'Dépôt de ' else 'Retrait de ' end||(j->>'montant')||' — '||coalesce(cn,'?')||' ('||coalesce(num,'')||')';

  elsif TG_TABLE_NAME='prets' then
    typ:='PRET';
    if TG_OP='INSERT' then
      msg:='Nouvelle demande de prêt '||(j->>'numero_pret')||' : '||(j->>'montant');
    elsif (o->>'statut')='DEMANDE' and (j->>'statut') in ('EN_COURS','REJETE') then
      msg:='Prêt '||(j->>'numero_pret')||case when (j->>'statut')='EN_COURS' then ' approuvé et décaissé' else ' rejeté' end;
      creator:=(j->>'created_by')::uuid;
      if creator is not null and creator<>u.id then
        insert into notifications(entreprise_id,destinataire_id,auteur_id,auteur_nom,type,message,ref_table,ref_id)
        values(ent,creator,u.id,coalesce(u.nom_complet,u.username),'PRET',
          'Votre demande de prêt '||(j->>'numero_pret')||case when (j->>'statut')='EN_COURS' then ' a été approuvée' else ' a été rejetée' end,'prets',rid);
      end if;
    else
      return null;
    end if;

  elsif TG_TABLE_NAME='paiements_pret' then
    typ:='PAIEMENT';
    select numero_pret into num from prets where id=(j->>'pret_id')::uuid;
    msg:='Paiement de '||(j->>'montant')||' sur le prêt '||coalesce(num,'?');
  end if;

  if msg is null then return null; end if;
  insert into audit_log(entreprise_id,user_id,username,action,table_name,record_id,details)
  values(ent,u.id,coalesce(u.nom_complet,u.username),TG_TABLE_NAME||'.'||TG_OP,TG_TABLE_NAME,rid,msg);
  if u.role<>'ADMIN' then
    insert into notifications(entreprise_id,destinataire_id,auteur_id,auteur_nom,type,message,ref_table,ref_id)
    values(ent,null,u.id,coalesce(u.nom_complet,u.username)||' ('||u.role||')',typ,msg,TG_TABLE_NAME,rid);
  end if;
  return null;
end $$;

create trigger n_clients    after insert or update or delete on clients        for each row execute function trg_notify();
create trigger n_comptes    after insert or update            on comptes        for each row execute function trg_notify();
create trigger n_depots     after insert                      on depots         for each row execute function trg_notify();
create trigger n_retraits   after insert                      on retraits       for each row execute function trg_notify();
create trigger n_prets      after insert or update            on prets          for each row execute function trg_notify();
create trigger n_paiements  after insert                      on paiements_pret for each row execute function trg_notify();

-- ============================================================
-- 4. FONCTIONS MÉTIER (RPC) — toutes les opérations financières sont atomiques
-- ============================================================
create or replace function rpc_ouvrir_compte(p_client uuid,p_type int,p_depot numeric,p_date date) returns uuid
language plpgsql security definer set search_path=public as $$
declare e uuid; tc types_compte%rowtype; v_id uuid; v_num text; v_dep numeric; v_d date;
begin
  e:=_need(array['ADMIN','AGENT','CAISSIER']);
  if not exists(select 1 from clients where id=p_client and entreprise_id=e) then raise exception 'Client introuvable'; end if;
  select * into tc from types_compte where id=p_type and entreprise_id=e and actif;
  if tc.id is null then raise exception 'Type de compte invalide'; end if;
  v_dep:=round(coalesce(p_depot,0),2); v_d:=coalesce(p_date,current_date);
  if v_dep<tc.depot_min then raise exception 'Dépôt initial minimum : % G',tc.depot_min; end if;
  if v_dep<tc.frais_ouv then raise exception 'Le dépôt doit couvrir les frais d''ouverture (% G)',tc.frais_ouv; end if;
  v_num:='AYF-'||to_char(now(),'YYYY')||'-'||lpad(nextval('seq_compte')::text,6,'0');
  insert into comptes(entreprise_id,client_id,type_compte_id,numero_compte_interne,solde,date_ouverture,statut)
  values(e,p_client,tc.id,v_num,v_dep-tc.frais_ouv,v_d,'ACTIF') returning id into v_id;
  if v_dep>0 then
    insert into depots(entreprise_id,compte_id,montant,date_operation,description,created_by) values(e,v_id,v_dep,v_d,'Dépôt initial',auth.uid());
    insert into transactions(entreprise_id,compte_id,type_transaction,montant,description,created_by) values(e,v_id,'DEPOT',v_dep,'Dépôt initial',auth.uid());
  end if;
  if tc.frais_ouv>0 then
    insert into transactions(entreprise_id,compte_id,type_transaction,montant,description,created_by) values(e,v_id,'FRAIS',-tc.frais_ouv,'Frais d''ouverture',auth.uid());
  end if;
  return v_id;
end $$;

create or replace function rpc_depot(p_compte uuid,p_montant numeric,p_date date,p_desc text) returns void
language plpgsql security definer set search_path=public as $$
declare e uuid; c comptes%rowtype; m numeric:=round(coalesce(p_montant,0),2); v_d date:=coalesce(p_date,current_date);
begin
  e:=_need(array['ADMIN','AGENT','CAISSIER']);
  if m<=0 then raise exception 'Montant invalide'; end if;
  select * into c from comptes where id=p_compte and entreprise_id=e for update;
  if c.id is null then raise exception 'Compte introuvable'; end if;
  if c.statut<>'ACTIF' then raise exception 'Ce compte n''est pas actif'; end if;
  update comptes set solde=solde+m where id=c.id;
  insert into depots(entreprise_id,compte_id,montant,date_operation,description,created_by) values(e,c.id,m,v_d,p_desc,auth.uid());
  insert into transactions(entreprise_id,compte_id,type_transaction,montant,description,created_by) values(e,c.id,'DEPOT',m,p_desc,auth.uid());
end $$;

create or replace function rpc_retrait(p_compte uuid,p_montant numeric,p_date date,p_desc text) returns void
language plpgsql security definer set search_path=public as $$
declare e uuid; c comptes%rowtype; m numeric:=round(coalesce(p_montant,0),2); v_d date:=coalesce(p_date,current_date);
begin
  e:=_need(array['ADMIN','AGENT','CAISSIER']);
  if m<=0 then raise exception 'Montant invalide'; end if;
  select * into c from comptes where id=p_compte and entreprise_id=e for update;
  if c.id is null then raise exception 'Compte introuvable'; end if;
  if c.statut<>'ACTIF' then raise exception 'Ce compte n''est pas actif'; end if;
  if m>c.solde then raise exception 'Solde insuffisant (% G disponible)',c.solde; end if;
  if m>_caisse(e) then raise exception 'Caisse insuffisante pour ce retrait'; end if;
  update comptes set solde=solde-m where id=c.id;
  insert into retraits(entreprise_id,compte_id,montant,date_operation,description,created_by) values(e,c.id,m,v_d,p_desc,auth.uid());
  insert into transactions(entreprise_id,compte_id,type_transaction,montant,description,created_by) values(e,c.id,'RETRAIT',-m,p_desc,auth.uid());
end $$;

create or replace function rpc_cloturer_compte(p_compte uuid) returns void
language plpgsql security definer set search_path=public as $$
declare e uuid; c comptes%rowtype;
begin
  e:=_need(array['ADMIN','AGENT']);
  select * into c from comptes where id=p_compte and entreprise_id=e for update;
  if c.id is null then raise exception 'Compte introuvable'; end if;
  if c.statut='FERME' then raise exception 'Compte déjà clôturé'; end if;
  if exists(select 1 from prets where compte_id=c.id and statut in ('DEMANDE','EN_COURS','RETARD')) then
    raise exception 'Clôture impossible : un prêt est lié à ce compte';
  end if;
  if c.solde>_caisse(e) then raise exception 'Caisse insuffisante pour rembourser le solde du compte'; end if;
  if c.solde>0 then
    insert into retraits(entreprise_id,compte_id,montant,date_operation,description,created_by) values(e,c.id,c.solde,current_date,'Clôture de compte',auth.uid());
    insert into transactions(entreprise_id,compte_id,type_transaction,montant,description,created_by) values(e,c.id,'RETRAIT',-c.solde,'Clôture de compte',auth.uid());
  end if;
  update comptes set solde=0,statut='FERME' where id=c.id;
end $$;

-- Création d'une DEMANDE de prêt : taux imposé par le type de prêt, échéancier calculé côté serveur
create or replace function rpc_creer_pret(p_client uuid,p_compte uuid,p_type int,p_montant numeric,p_duree int,p_date date) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  e uuid; tp types_pret%rowtype; cp comptes%rowtype; v_c numeric; v_t numeric; v_int numeric; v_tot numeric; v_mens numeric;
  v_id uuid; v_num text; v_d date; i int; v_capi numeric; v_inti numeric; v_sc numeric:=0; v_si numeric:=0; v_cum numeric:=0; v_mi numeric;
begin
  e:=_need(array['ADMIN','AGENT']);
  select * into tp from types_pret where id=p_type and entreprise_id=e and actif;
  if tp.id is null then raise exception 'Type de prêt invalide'; end if;
  select * into cp from comptes where id=p_compte and entreprise_id=e and client_id=p_client and statut='ACTIF';
  if cp.id is null then raise exception 'Le compte épargne doit appartenir au client et être actif'; end if;
  v_c:=round(coalesce(p_montant,0),2);
  if v_c<tp.montant_min or v_c>tp.montant_max then raise exception 'Montant autorisé : % à % G',tp.montant_min,tp.montant_max; end if;
  if p_duree is null or p_duree<1 or p_duree>tp.duree_max then raise exception 'Durée autorisée : 1 à % mois',tp.duree_max; end if;
  if exists(select 1 from prets where client_id=p_client and statut='RETARD') then raise exception 'Ce client a un prêt en retard : nouvelle demande refusée'; end if;
  v_t:=tp.taux_mensuel/100;
  v_int:=round(v_c*v_t*p_duree,2); v_tot:=v_c+v_int; v_mens:=round(v_tot/p_duree,2);
  v_d:=coalesce(p_date,current_date);
  v_num:='PR'||to_char(now(),'YYYY')||lpad(nextval('seq_pret')::text,6,'0');
  insert into prets(entreprise_id,client_id,compte_id,type_pret_id,numero_pret,montant,taux_interet_mensuel,duree_mois,date_debut,date_fin,
                    montant_interet,montant_total,mensualite,frais_dossier,solde_restant,statut,created_by)
  values(e,p_client,p_compte,tp.id,v_num,v_c,tp.taux_mensuel,p_duree,v_d,(v_d+(p_duree::text||' month')::interval)::date,
         v_int,v_tot,v_mens,tp.frais,v_tot,'DEMANDE',auth.uid()) returning id into v_id;
  for i in 1..p_duree loop
    if i=p_duree then v_capi:=v_c-v_sc; v_inti:=v_int-v_si;
    else v_capi:=round(v_c/p_duree,2); v_inti:=round(v_int/p_duree,2); end if;
    v_sc:=v_sc+v_capi; v_si:=v_si+v_inti; v_mi:=v_capi+v_inti; v_cum:=v_cum+v_mi;
    insert into echeances(entreprise_id,pret_id,numero_echeance,date_echeance,montant_echeance,capital,interet,solde_restant,statut)
    values(e,v_id,i,(v_d+(i::text||' month')::interval)::date,v_mi,v_capi,v_inti,v_tot-v_cum,'EN_ATTENTE');
  end loop;
  return v_id;
end $$;

-- SEUL un ADMIN de l'entreprise peut approuver
create or replace function rpc_approuver_pret(p_pret uuid) returns void
language plpgsql security definer set search_path=public as $$
declare e uuid; p prets%rowtype; v_net numeric; v_d date:=current_date;
begin
  e:=_need(array['ADMIN']);
  select * into p from prets where id=p_pret and entreprise_id=e for update;
  if p.id is null then raise exception 'Prêt introuvable'; end if;
  if p.statut<>'DEMANDE' then raise exception 'Ce prêt n''est plus en attente'; end if;
  v_net:=p.montant-p.frais_dossier;
  if _caisse(e)<v_net then raise exception 'Caisse insuffisante (% G) pour décaisser % G',_caisse(e),v_net; end if;
  update prets set statut='EN_COURS',date_approbation=now(),date_decaissement=v_d,date_debut=v_d,
         date_fin=(v_d+(duree_mois::text||' month')::interval)::date,approved_by=auth.uid() where id=p.id;
  update echeances set date_echeance=(v_d+(numero_echeance::text||' month')::interval)::date where pret_id=p.id;
  insert into transactions(entreprise_id,pret_id,type_transaction,montant,description,created_by)
  values(e,p.id,'PRET_DEBLOCAGE',-v_net,'Décaissement '||p.numero_pret||' (frais de dossier retenus : '||p.frais_dossier||')',auth.uid());
end $$;

create or replace function rpc_rejeter_pret(p_pret uuid,p_motif text) returns void
language plpgsql security definer set search_path=public as $$
declare e uuid; p prets%rowtype;
begin
  e:=_need(array['ADMIN']);
  select * into p from prets where id=p_pret and entreprise_id=e for update;
  if p.id is null then raise exception 'Prêt introuvable'; end if;
  if p.statut<>'DEMANDE' then raise exception 'Ce prêt n''est plus en attente'; end if;
  update prets set statut='REJETE',motif_rejet=nullif(trim(p_motif),'') where id=p.id;
end $$;

create or replace function rpc_payer_pret(p_pret uuid,p_montant numeric,p_date date,p_desc text) returns void
language plpgsql security definer set search_path=public as $$
declare
  e uuid; p prets%rowtype; m numeric:=round(coalesce(p_montant,0),2); v_d date:=coalesce(p_date,current_date);
  v_ip numeric; v_cp numeric; v_ir numeric; v_cr numeric; v_ipaid numeric; v_cpaid numeric; v_solde numeric; v_tp numeric; v_stat text;
begin
  e:=_need(array['ADMIN','AGENT','CAISSIER']);
  if m<=0 then raise exception 'Montant invalide'; end if;
  select * into p from prets where id=p_pret and entreprise_id=e for update;
  if p.id is null then raise exception 'Prêt introuvable'; end if;
  if p.statut not in ('EN_COURS','RETARD') then raise exception 'Ce prêt n''accepte pas de paiement (statut %)',p.statut; end if;
  if m>p.solde_restant then raise exception 'Le montant dépasse le solde restant (% G)',p.solde_restant; end if;
  select coalesce(sum(interet_paye),0),coalesce(sum(capital_rembourse),0) into v_ipaid,v_cpaid from paiements_pret where pret_id=p.id;
  v_ir:=greatest(0,p.montant_interet-v_ipaid); v_cr:=greatest(0,p.montant-v_cpaid);
  v_ip:=least(m,v_ir); v_cp:=least(m-v_ip,v_cr);
  insert into paiements_pret(entreprise_id,pret_id,date_paiement,montant,capital_rembourse,interet_paye,description,created_by)
  values(e,p.id,v_d,m,v_cp,v_ip,p_desc,auth.uid());
  v_solde:=round(greatest(0,p.solde_restant-m),2);
  v_tp:=p.montant_total-v_solde;
  update echeances x set statut='PAYE',date_paiement=v_d
  from (select id,sum(montant_echeance) over (order by numero_echeance) cum from echeances where pret_id=p.id) c
  where x.id=c.id and x.statut<>'PAYE' and c.cum<=v_tp+0.004;
  if v_solde<=0 then v_stat:='REMBOURSE';
  elsif exists(select 1 from echeances where pret_id=p.id and statut<>'PAYE' and date_echeance<current_date) then v_stat:='RETARD';
  else v_stat:='EN_COURS'; end if;
  update prets set solde_restant=v_solde,statut=v_stat where id=p.id;
  insert into transactions(entreprise_id,pret_id,type_transaction,montant,description,created_by)
  values(e,p.id,'REMBOURSEMENT_PRET',m,'Remboursement prêt '||p.numero_pret,auth.uid());
end $$;

create or replace function rpc_maj_retards() returns void
language plpgsql security definer set search_path=public as $$
declare e uuid;
begin
  e:=my_entreprise_id(); if e is null then return; end if;
  update echeances set statut='RETARD'
   where entreprise_id=e and statut='EN_ATTENTE' and date_echeance<current_date
     and pret_id in (select id from prets where statut in ('EN_COURS','RETARD'));
  update prets set statut='RETARD'
   where entreprise_id=e and statut='EN_COURS'
     and exists(select 1 from echeances where pret_id=prets.id and statut='RETARD');
end $$;

-- ============================================================
-- 5. GESTION DES UTILISATEURS & SUPER ADMIN
-- ============================================================
create or replace function rpc_check_user_quota(p_entreprise uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_max int; v_n int;
begin
  if not is_superadmin() then
    if coalesce(my_role(),'')<>'ADMIN' or my_entreprise_id() is distinct from p_entreprise then
      raise exception 'Action non autorisée';
    end if;
  end if;
  select max_users into v_max from entreprises where id=p_entreprise;
  if v_max is null then raise exception 'Entreprise introuvable'; end if;
  select count(*) into v_n from users where entreprise_id=p_entreprise and actif;
  if v_n>=v_max then raise exception 'Limite atteinte : % utilisateur(s) maximum pour cette entreprise',v_max; end if;
end $$;

create or replace function register_profile(p_id uuid,p_entreprise uuid,p_username text,p_nom text,p_tel text,p_role text,p_email text) returns void
language plpgsql security definer set search_path=public as $$
declare v_auth auth.users%rowtype;
begin
  if p_role not in ('SUPERADMIN','ADMIN','AGENT','CAISSIER') then raise exception 'Rôle invalide'; end if;
  if p_role='SUPERADMIN' then
    if not is_superadmin() or p_entreprise is not null then raise exception 'Action non autorisée'; end if;
  else
    perform rpc_check_user_quota(p_entreprise);
  end if;
  select * into v_auth from auth.users where id=p_id;
  if v_auth.id is null then raise exception 'Compte d''authentification introuvable'; end if;
  if v_auth.created_at < now()-interval '30 minutes' then raise exception 'Compte d''authentification trop ancien'; end if;
  if exists(select 1 from users where id=p_id) then raise exception 'Profil déjà existant'; end if;
  insert into users(id,entreprise_id,username,nom_complet,email,telephone,role,actif)
  values(p_id,p_entreprise,coalesce(nullif(trim(p_username),''),split_part(v_auth.email,'@',1)),nullif(trim(p_nom),''),v_auth.email,nullif(trim(p_tel),''),p_role,true);
  perform _audit(p_entreprise,'users.INSERT','users',p_id,'Utilisateur créé : '||coalesce(nullif(trim(p_nom),''),v_auth.email)||' ('||p_role||')');
end $$;

create or replace function sa_create_entreprise(p_nom text,p_slogan text,p_adresse text,p_tel text,p_email text,p_devise text,
  p_max_users int,p_date_fin date,p_plan text,p_notes text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not is_superadmin() then raise exception 'Réservé au super administrateur'; end if;
  insert into entreprises(nom,slogan,adresse,telephone,email,devise,max_users,date_contrat_fin,plan,notes)
  values(trim(p_nom),p_slogan,p_adresse,p_tel,p_email,coalesce(p_devise,'HTG'),greatest(1,coalesce(p_max_users,10)),p_date_fin,coalesce(p_plan,'STANDARD'),p_notes)
  returning id into v_id;
  insert into types_compte(entreprise_id,nom,taux,depot_min,frais_ouv,frais_mens) values
    (v_id,'Compte Épargne Classique',2.5,500,100,0),
    (v_id,'Compte Épargne Jeune',3.0,100,25,0),
    (v_id,'Compte Épargne Entreprise',1.8,2000,250,0);
  insert into types_pret(entreprise_id,nom,taux_mensuel,duree_max,montant_min,montant_max,frais) values
    (v_id,'Prêt Personnel',1.0,24,1000,50000,100),
    (v_id,'Prêt Immobilier',0.67,60,50000,500000,500),
    (v_id,'Prêt Étudiant',0.5,36,500,20000,50),
    (v_id,'Prêt Urgence',1.25,12,100,5000,25);
  perform _audit(v_id,'entreprises.INSERT','entreprises',v_id,'Entreprise créée : '||trim(p_nom));
  return v_id;
end $$;

create or replace function sa_toggle_entreprise(p_id uuid,p_actif boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not is_superadmin() then raise exception 'Réservé au super administrateur'; end if;
  update entreprises set actif=p_actif where id=p_id;
  perform _audit(p_id,'entreprises.UPDATE','entreprises',p_id,case when p_actif then 'Accès entreprise réactivé' else 'Accès entreprise SUSPENDU' end);
end $$;

create or replace function sa_overview() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not is_superadmin() then raise exception 'Réservé au super administrateur'; end if;
  return coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object(
    'nb_users',(select count(*) from users u where u.entreprise_id=e.id),
    'nb_users_actifs',(select count(*) from users u where u.entreprise_id=e.id and u.actif),
    'nb_clients',(select count(*) from clients c where c.entreprise_id=e.id),
    'nb_comptes',(select count(*) from comptes c where c.entreprise_id=e.id),
    'nb_prets',(select count(*) from prets p where p.entreprise_id=e.id and p.statut in ('EN_COURS','RETARD')),
    'epargne',(select coalesce(sum(solde),0) from comptes c where c.entreprise_id=e.id),
    'encours',(select coalesce(sum(solde_restant),0) from prets p where p.entreprise_id=e.id and p.statut in ('EN_COURS','RETARD'))
  ) order by e.created_at desc) from entreprises e),'[]'::jsonb);
end $$;

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
alter table entreprises enable row level security;
alter table users enable row level security;
alter table types_compte enable row level security;
alter table types_pret enable row level security;
alter table clients enable row level security;
alter table comptes enable row level security;
alter table depots enable row level security;
alter table retraits enable row level security;
alter table transactions enable row level security;
alter table prets enable row level security;
alter table echeances enable row level security;
alter table paiements_pret enable row level security;
alter table garanties enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

-- entreprises
create policy ent_sel on entreprises for select using (is_superadmin() or id=(select my_entreprise_raw()));
create policy ent_upd on entreprises for update using (is_superadmin() or (id=(select my_entreprise_id()) and (select my_role())='ADMIN'));
create policy ent_ins on entreprises for insert with check (is_superadmin());

-- users
create policy usr_sel on users for select using (id=auth.uid() or is_superadmin() or entreprise_id=(select my_entreprise_id()));
create policy usr_upd on users for update using (
  is_superadmin() or id=auth.uid() or (entreprise_id=(select my_entreprise_id()) and (select my_role())='ADMIN'));

-- lecture des tables métier (isolation par entreprise)
do $$ declare t text; begin
  foreach t in array array['types_compte','types_pret','clients','comptes','depots','retraits','transactions','prets','echeances','paiements_pret','garanties'] loop
    execute format('create policy %I on %I for select using (entreprise_id=(select my_entreprise_id()) or is_superadmin())', t||'_sel', t);
  end loop;
end $$;

-- écriture directe : seulement clients, garanties, types (le reste passe par les fonctions rpc_*)
create policy clients_ins on clients for insert with check (entreprise_id=(select my_entreprise_id()) and (select my_role()) in ('ADMIN','AGENT'));
create policy clients_upd on clients for update using (entreprise_id=(select my_entreprise_id()) and (select my_role()) in ('ADMIN','AGENT'))
  with check (entreprise_id=(select my_entreprise_id()));
create policy clients_del on clients for delete using (entreprise_id=(select my_entreprise_id()) and (select my_role())='ADMIN');
create policy gar_w on garanties for all using (entreprise_id=(select my_entreprise_id()) and (select my_role()) in ('ADMIN','AGENT'))
  with check (entreprise_id=(select my_entreprise_id()));
create policy tc_w on types_compte for all using (entreprise_id=(select my_entreprise_id()) and (select my_role())='ADMIN')
  with check (entreprise_id=(select my_entreprise_id()));
create policy tp_w on types_pret for all using (entreprise_id=(select my_entreprise_id()) and (select my_role())='ADMIN')
  with check (entreprise_id=(select my_entreprise_id()));

-- notifications : ADMIN voit celles de l'entreprise ; chacun voit les siennes
create policy not_sel on notifications for select using (
  entreprise_id=(select my_entreprise_id()) and (destinataire_id=auth.uid() or (destinataire_id is null and (select my_role())='ADMIN')));
create policy not_upd on notifications for update using (
  entreprise_id=(select my_entreprise_id()) and (destinataire_id=auth.uid() or (destinataire_id is null and (select my_role())='ADMIN')))
  with check (entreprise_id=(select my_entreprise_id()));

-- journal d'audit
create policy aud_sel on audit_log for select using (
  is_superadmin() or (entreprise_id=(select my_entreprise_id()) and (select my_role())='ADMIN'));

-- ============================================================
-- 7. STORAGE (logos d'entreprise + photos de profil)
-- ============================================================
insert into storage.buckets(id,name,public) values('logos','logos',true),('avatars','avatars',true) on conflict (id) do nothing;

create policy logos_read on storage.objects for select using (bucket_id in ('logos','avatars'));
create policy logos_ins on storage.objects for insert to authenticated with check (
  bucket_id='logos' and (is_superadmin() or ((storage.foldername(name))[1]=(select my_entreprise_id())::text and (select my_role())='ADMIN')));
create policy logos_upd on storage.objects for update to authenticated using (
  bucket_id='logos' and (is_superadmin() or ((storage.foldername(name))[1]=(select my_entreprise_id())::text and (select my_role())='ADMIN')));
create policy avatars_ins on storage.objects for insert to authenticated with check (
  bucket_id='avatars' and ((storage.foldername(name))[1]=auth.uid()::text or is_superadmin()));
create policy avatars_upd on storage.objects for update to authenticated using (
  bucket_id='avatars' and ((storage.foldername(name))[1]=auth.uid()::text or is_superadmin()));

-- ============================================================
-- 8. PERMISSIONS
-- ============================================================
grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function _need(text[]), _audit(uuid,text,text,uuid,text), _caisse(uuid) from authenticated;

-- ============================================================
-- 9. TEMPS RÉEL
-- ============================================================
do $$ declare t text; begin
  foreach t in array array['entreprises','users','clients','comptes','depots','retraits','transactions','prets','echeances','paiements_pret','garanties','notifications','types_compte','types_pret'] loop
    begin execute format('alter publication supabase_realtime add table %I',t); exception when others then null; end;
    execute format('alter table %I replica identity full',t);
  end loop;
end $$;

-- ============================================================
-- 10. CRÉATION DU SUPER ADMIN
-- Étape préalable : Supabase → Authentication → Users → Add user
--   email : admin@ayifin.com  | mot de passe FORT et NOUVEAU | cocher "Auto Confirm User"
-- Puis (re)lancer ce bloc :
-- ============================================================
insert into users(id,entreprise_id,username,nom_complet,email,role,actif)
select id,null,'superadmin','ING. Worvensky-Wadson PIERRE',email,'SUPERADMIN',true
from auth.users where email='admin@ayifin.com'
on conflict (id) do update set role='SUPERADMIN',entreprise_id=null,actif=true;
