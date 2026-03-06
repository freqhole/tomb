-- function to lookup user info by node_id
-- returns user info only if the node_id owner is in a shared group with the caller
-- this is used for on-the-fly user creation when a peer connects via P2P
create or replace function public.get_user_by_node_id(p_node_id text)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  node_id text,
  group_id uuid,
  group_name text
) as $$
begin
  return query
  select distinct
    p.user_id,
    pr.display_name,
    pr.avatar_url,
    p.node_id,
    p.group_id,
    g.name as group_name
  from public.peers p
  join public.profiles pr on pr.id = p.user_id
  join public.groups g on g.id = p.group_id
  where p.node_id = p_node_id
  and p.group_id in (
    select gm.group_id from public.group_members gm where gm.user_id = auth.uid()
  )
  limit 1;
end;
$$ language plpgsql security definer stable;
