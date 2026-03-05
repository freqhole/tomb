-- haruspex initial schema
-- p2p federation coordination for freqhole

-- profiles (extends supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- groups for peer discovery
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  invite_code text unique not null default encode(gen_random_bytes(8), 'hex'),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz default now()
);

-- group membership
create type public.group_role as enum ('owner', 'admin', 'member');

create table public.group_members (
  group_id uuid references public.groups on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- peer presence (online freqhole instances)
-- note: NO IP addresses - iroh only needs node_id + optional relay_url
create table public.peers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete cascade,
  group_id uuid references public.groups on delete cascade,
  node_id text not null,
  relay_url text,
  instance_name text,
  last_seen timestamptz default now(),
  unique (user_id, group_id, node_id)
);

-- indexes for common queries
create index idx_peers_group_id on public.peers(group_id);
create index idx_peers_user_id on public.peers(user_id);
create index idx_peers_last_seen on public.peers(last_seen);
create index idx_group_members_user_id on public.group_members(user_id);
create index idx_groups_invite_code on public.groups(invite_code);

-- enable RLS
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.peers enable row level security;

-- profiles: viewable by authenticated users, update own
create policy "profiles viewable by authenticated"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- groups: viewable by members, anyone can create
create policy "groups visible to members"
  on public.groups for select
  using (
    id in (select group_id from public.group_members where user_id = auth.uid())
    or created_by = auth.uid()
  );

create policy "authenticated users can create groups"
  on public.groups for insert
  with check (auth.role() = 'authenticated' and created_by = auth.uid());

create policy "group creators can update"
  on public.groups for update
  using (created_by = auth.uid());

create policy "group admins can update"
  on public.groups for update
  using (
    id in (
      select group_id from public.group_members 
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "group owners can delete"
  on public.groups for delete
  using (
    id in (
      select group_id from public.group_members 
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- group_members: see memberships in your groups, join/leave
-- users can always see their own memberships (no recursion)
create policy "users can see own memberships"
  on public.group_members for select
  using (user_id = auth.uid());

create policy "users can join groups"
  on public.group_members for insert
  with check (user_id = auth.uid());

create policy "users can leave groups"
  on public.group_members for delete
  using (user_id = auth.uid());

-- admins can remove members (use security definer function instead to avoid recursion)

-- peers: visible to group members, manage own
create policy "peers visible to group members"
  on public.peers for select
  using (
    group_id in (
      select group_id from public.group_members
      where user_id = auth.uid()
    )
  );

create policy "users can insert own peers"
  on public.peers for insert
  with check (user_id = auth.uid());

create policy "users can update own peers"
  on public.peers for update
  using (user_id = auth.uid());

create policy "users can delete own peers"
  on public.peers for delete
  using (user_id = auth.uid());

-- function to auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$ language plpgsql security definer;

-- trigger to create profile on auth.users insert
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- function to join group by invite code
create or replace function public.join_group_by_invite(code text)
returns uuid as $$
declare
  gid uuid;
begin
  select id into gid from public.groups where invite_code = code;
  if gid is null then
    raise exception 'invalid invite code';
  end if;
  
  insert into public.group_members (group_id, user_id)
  values (gid, auth.uid())
  on conflict do nothing;
  
  return gid;
end;
$$ language plpgsql security definer;

-- function to update peer heartbeat
create or replace function public.update_peer_presence(
  p_node_id text,
  p_group_id uuid,
  p_relay_url text default null,
  p_instance_name text default null
)
returns uuid as $$
declare
  peer_id uuid;
begin
  insert into public.peers (user_id, group_id, node_id, relay_url, instance_name, last_seen)
  values (auth.uid(), p_group_id, p_node_id, p_relay_url, p_instance_name, now())
  on conflict (user_id, group_id, node_id)
  do update set
    relay_url = coalesce(excluded.relay_url, peers.relay_url),
    instance_name = coalesce(excluded.instance_name, peers.instance_name),
    last_seen = now()
  returning id into peer_id;
  
  return peer_id;
end;
$$ language plpgsql security definer;

-- function to get online peers in user's groups
create or replace function public.get_online_peers(stale_minutes int default 5)
returns table (
  peer_id uuid,
  user_id uuid,
  group_id uuid,
  display_name text,
  avatar_url text,
  node_id text,
  relay_url text,
  instance_name text,
  last_seen timestamptz,
  group_name text
) as $$
begin
  return query
  select
    p.id as peer_id,
    p.user_id,
    p.group_id,
    pr.display_name,
    pr.avatar_url,
    p.node_id,
    p.relay_url,
    p.instance_name,
    p.last_seen,
    g.name as group_name
  from public.peers p
  join public.profiles pr on pr.id = p.user_id
  join public.groups g on g.id = p.group_id
  where p.group_id in (
    select gm.group_id from public.group_members gm where gm.user_id = auth.uid()
  )
  and p.user_id != auth.uid()
  and p.last_seen > now() - (stale_minutes || ' minutes')::interval
  order by p.last_seen desc;
end;
$$ language plpgsql security definer;
