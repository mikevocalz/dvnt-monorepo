-- Only the authenticated Edge Function may supply an auth identity to this RPC.
CREATE OR REPLACE FUNCTION public.set_message_reaction(
  p_message_id bigint,
  p_auth_id text,
  p_emoji text,
  p_desired_present boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  viewer record;
  message_row record;
  reactions jsonb;
  cleaned jsonb;
  existed boolean;
  desired boolean;
BEGIN
  IF p_emoji IS NULL OR p_emoji NOT IN ('😂','😢','😊','😈','🥵','💝','❤️') THEN
    RETURN jsonb_build_object('ok',false,'code','bad_request');
  END IF;
  SELECT id, username INTO viewer FROM public.users WHERE auth_id = p_auth_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
  SELECT id, conversation_id, sender_id, metadata INTO message_row
    FROM public.messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations_rels WHERE parent_id = message_row.conversation_id AND users_id = p_auth_id
  ) THEN RETURN jsonb_build_object('ok',false,'code','forbidden'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.blocks b
    WHERE (b.blocker_id = viewer.id AND b.blocked_id = message_row.sender_id)
       OR (b.blocked_id = viewer.id AND b.blocker_id = message_row.sender_id)
  ) OR EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.conversations_rels r ON r.parent_id = c.id
    JOIN public.users u ON u.auth_id = r.users_id
    JOIN public.blocks b ON (b.blocker_id = viewer.id AND b.blocked_id = u.id)
                         OR (b.blocked_id = viewer.id AND b.blocker_id = u.id)
    WHERE c.id = message_row.conversation_id AND NOT coalesce(c.is_group,false)
  ) THEN RETURN jsonb_build_object('ok',false,'code','forbidden'); END IF;

  reactions := CASE WHEN jsonb_typeof(message_row.metadata->'reactions') = 'array'
    THEN message_row.metadata->'reactions' ELSE '[]'::jsonb END;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(reactions) r
    WHERE r->>'emoji' = p_emoji AND r->>'userId' = viewer.id::text) INTO existed;
  desired := coalesce(p_desired_present, NOT existed);
  IF desired = existed THEN
    RETURN jsonb_build_object('ok',true,'reactions',reactions,'toggled','unchanged','present',desired);
  END IF;
  SELECT coalesce(jsonb_agg(r),'[]'::jsonb) INTO cleaned FROM jsonb_array_elements(reactions) r
    WHERE NOT (coalesce(r->>'emoji','') = p_emoji AND coalesce(r->>'userId','') = viewer.id::text);
  IF desired THEN
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('emoji',p_emoji,'userId',viewer.id::text,
      'username',coalesce(viewer.username,'user')));
  END IF;
  UPDATE public.messages SET metadata = jsonb_set(coalesce(message_row.metadata,'{}'::jsonb),'{reactions}',cleaned,true)
    WHERE id = p_message_id;
  RETURN jsonb_build_object('ok',true,'reactions',cleaned,'toggled',CASE WHEN desired THEN 'added' ELSE 'removed' END,'present',desired);
END;
$$;
REVOKE ALL ON FUNCTION public.set_message_reaction(bigint,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_message_reaction(bigint,text,text,boolean) TO service_role;
