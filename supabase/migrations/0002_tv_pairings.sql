-- ============================================================================
--  Onboarding TV par QR code — table `tv_pairings` (Phase 2f)
--  Voir docs/native-port.md §4 (Phase 2f) et CLAUDE.md §XI.
--
--  À exécuter dans Supabase → SQL Editor.
--
--  But : une box Android TV ne peut pas saisir e-mail / mot de passe /
--  identifiants Xtream confortablement à la télécommande. La TV affiche un
--  QR code ; l'utilisateur le scanne avec son téléphone, se connecte et
--  choisit son profil côté mobile, et la TV reçoit la session.
--
--  Sécurité :
--   - La table est SCELLÉE : RLS activée, AUCUNE policy → ni `anon` ni
--     `authenticated` ne peuvent la lire/écrire directement. Tout accès passe
--     par les 3 RPC `SECURITY DEFINER` ci-dessous (même principe que
--     `public_profiles` / `get_member_watched`, CLAUDE.md §IV-15).
--   - Les tokens de session sont au repos quelques secondes seulement (entre
--     `authorize` et `claim`), puis NULLIFIÉS au `claim`.
--   - `code` : aléatoire 122 bits, jamais affiché ailleurs que sur la TV de
--     l'utilisateur. TTL court (5 min). `claim` est atomique et à usage unique.
-- ============================================================================

create table if not exists public.tv_pairings (
  id            uuid primary key default gen_random_uuid(),
  -- Code porté par le QR code (= aussi le nom du canal Realtime broadcast).
  code          text not null unique,
  -- 'pending'  : créée par la TV, en attente du téléphone
  -- 'authorized': le téléphone a déposé la session
  -- 'consumed' : la TV a récupéré la session (usage unique)
  status        text not null default 'pending',
  user_id       uuid references auth.users (id)            on delete cascade,
  profile_id    uuid references public.iptv_profiles (id)  on delete cascade,
  access_token  text,
  refresh_token text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '5 minutes'),
  authorized_at timestamptz,
  consumed_at   timestamptz
);

create index if not exists tv_pairings_code_idx on public.tv_pairings (code);

-- RLS activée SANS aucune policy → table inaccessible en direct (sealed).
alter table public.tv_pairings enable row level security;
revoke all on public.tv_pairings from anon, authenticated;

-- ── RPC 1 : create_tv_pairing ───────────────────────────────────────────────
--  Appelée par la TV (non authentifiée). Crée une session d'appairage et
--  renvoie le code à encoder dans le QR.
create or replace function public.create_tv_pairing()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code    text := gen_random_uuid()::text;
  v_expires timestamptz := now() + interval '5 minutes';
begin
  -- Purge opportuniste des sessions expirées (pas de cron nécessaire).
  delete from public.tv_pairings where tv_pairings.expires_at < now();

  insert into public.tv_pairings (code, expires_at)
  values (v_code, v_expires);

  return query select v_code, v_expires;
end;
$$;

-- ── RPC 2 : authorize_tv_pairing ────────────────────────────────────────────
--  Appelée par le TÉLÉPHONE (authentifié). Dépose la session du compte sur la
--  ligne d'appairage. Vérifie que le profil choisi appartient bien à l'appelant.
create or replace function public.authorize_tv_pairing(
  p_code          text,
  p_profile_id    uuid,
  p_access_token  text,
  p_refresh_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentification requise';
  end if;

  -- Le profil doit appartenir à l'utilisateur authentifié.
  if not exists (
    select 1 from public.iptv_profiles
    where id = p_profile_id and user_id = v_uid
  ) then
    raise exception 'profil introuvable';
  end if;

  update public.tv_pairings
  set status        = 'authorized',
      user_id       = v_uid,
      profile_id    = p_profile_id,
      access_token  = p_access_token,
      refresh_token = p_refresh_token,
      authorized_at = now()
  where code = p_code
    and status = 'pending'
    and expires_at > now();

  if not found then
    raise exception 'session d''appairage invalide ou expirée';
  end if;
end;
$$;

-- ── RPC 3 : claim_tv_pairing ────────────────────────────────────────────────
--  Appelée par la TV (non authentifiée), en boucle, jusqu'à obtenir la
--  session. `SELECT ... FOR UPDATE` sérialise les appels concurrents →
--  usage unique garanti. Les tokens sont nullifiés dans la foulée.
create or replace function public.claim_tv_pairing(p_code text)
returns table (
  user_id       uuid,
  profile_id    uuid,
  access_token  text,
  refresh_token text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tv_pairings;
begin
  select * into v_row
  from public.tv_pairings
  where code = p_code
    and status = 'authorized'
    and expires_at > now()
  for update;

  if not found then
    return;  -- encore en attente, expirée, ou déjà consommée
  end if;

  update public.tv_pairings
  set status        = 'consumed',
      consumed_at    = now(),
      access_token   = null,
      refresh_token  = null
  where id = v_row.id;

  return query
    select v_row.user_id, v_row.profile_id,
           v_row.access_token, v_row.refresh_token;
end;
$$;

-- ── Droits d'exécution ──────────────────────────────────────────────────────
--  Par défaut une fonction est exécutable par PUBLIC : on révoque puis on
--  accorde explicitement. `authorize` n'est PAS ouverte à `anon`.
revoke all on function public.create_tv_pairing()                          from public;
revoke all on function public.authorize_tv_pairing(text, uuid, text, text) from public;
revoke all on function public.claim_tv_pairing(text)                       from public;

grant execute on function public.create_tv_pairing()                          to anon, authenticated;
grant execute on function public.authorize_tv_pairing(text, uuid, text, text) to authenticated;
grant execute on function public.claim_tv_pairing(text)                       to anon, authenticated;
