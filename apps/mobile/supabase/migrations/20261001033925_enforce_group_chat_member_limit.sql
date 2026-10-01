-- Enforce a hard 12-member ceiling on group conversations.
-- The app relies on the same number for call capacity, so a full group can
-- always be invited to a call without exceeding the media room limit.
CREATE OR REPLACE FUNCTION enforce_group_chat_member_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count integer;
  v_is_group boolean;
BEGIN
  -- Only restrict participants on group conversations.
  SELECT c.is_group INTO v_is_group
  FROM public.conversations c
  WHERE id = NEW.parent_id;

  IF v_is_group IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.path IS DISTINCT FROM 'participants' THEN
    RETURN NEW;
  END IF;

  -- Lock the parent conversation row so concurrent inserts serialize on the
  -- membership count instead of racing each other past the limit.
  PERFORM 1 FROM public.conversations WHERE id = NEW.parent_id FOR UPDATE;

  SELECT COUNT(*) INTO current_count
  FROM public.conversations_rels
  WHERE parent_id = NEW.parent_id
    AND path = 'participants';

  IF current_count >= 12 THEN
    RAISE EXCEPTION '12 MAX GROUP CHAT USERS';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS group_chat_member_limit_trigger ON public.conversations_rels;
CREATE TRIGGER group_chat_member_limit_trigger
BEFORE INSERT ON public.conversations_rels
FOR EACH ROW
EXECUTE FUNCTION enforce_group_chat_member_limit();
