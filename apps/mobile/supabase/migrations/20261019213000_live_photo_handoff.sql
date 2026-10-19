-- Draft migration: requires separate production approval. No direct client access.
-- Authenticated server upload provenance. Public media rows may have legacy
-- client-writable policies, so filename alone is NOT ownership evidence.
CREATE TABLE public.live_photo_upload_receipts (
  media_id bigint PRIMARY KEY,
  owner_auth_id text NOT NULL,
  object_key text NOT NULL,
  url text NOT NULL,
  mime_type text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image','video')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.live_photo_upload_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_photo_upload_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.live_photo_upload_receipts TO service_role;

CREATE TABLE public.live_photo_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  draft_id uuid NOT NULL,
  max_count integer NOT NULL CHECK (max_count BETWEEN 1 AND 10),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','consumed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  pairs jsonb,
  assets jsonb,
  consume_request_id uuid,
  UNIQUE(owner_id, draft_id)
);
ALTER TABLE public.live_photo_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_photo_handoffs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.live_photo_handoffs TO service_role;
CREATE INDEX live_photo_handoffs_expiry_idx ON public.live_photo_handoffs(expires_at);

-- Only the edge service can call this function and supplies the verified session
-- owner, never a client-provided owner. Row locks serialize competing operations.
CREATE FUNCTION public.live_photo_handoff_action(
  p_owner text, p_action text, p_draft uuid, p_id uuid DEFAULT NULL,
  p_max_count integer DEFAULT NULL, p_pairs jsonb DEFAULT NULL, p_request uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  h public.live_photo_handoffs%ROWTYPE;
  photo public.media%ROWTYPE;
  motion public.media%ROWTYPE;
  pair jsonb;
  result jsonb;
  assets_out jsonb := '[]'::jsonb;
  seen_ids bigint[] := ARRAY[]::bigint[];
  photo_id bigint;
  motion_id bigint;
BEGIN
  IF p_owner IS NULL OR p_owner = '' OR p_draft IS NULL OR p_action IS NULL OR p_action NOT IN ('create','status','complete','consume','cancel') THEN
    RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_REQUEST','message','Invalid request'));
  END IF;
  IF p_action = 'create' THEN
    IF p_max_count IS NULL OR p_max_count NOT BETWEEN 1 AND 10 THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_REQUEST','message','Invalid count'));
    END IF;
    -- Serialize creation per owner and bound abandoned active drafts. This is
    -- independent of edge instance memory and does not block idempotent retries.
    PERFORM pg_advisory_xact_lock(hashtextextended('live-photo-handoff:' || p_owner, 0));
    IF NOT EXISTS (SELECT 1 FROM public.live_photo_handoffs WHERE owner_id=p_owner AND draft_id=p_draft)
      AND (SELECT count(*) FROM public.live_photo_handoffs WHERE owner_id=p_owner AND state IN ('pending','ready') AND expires_at>clock_timestamp()) >= 5 THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','LIMIT_REACHED','message','Cancel an existing handoff before starting another'));
    END IF;
    -- Retries preserve original expiry and id; a new draft starts a new handoff.
    INSERT INTO public.live_photo_handoffs(owner_id,draft_id,max_count)
      VALUES(p_owner,p_draft,p_max_count) ON CONFLICT(owner_id,draft_id) DO NOTHING;
    SELECT * INTO h FROM public.live_photo_handoffs WHERE owner_id=p_owner AND draft_id=p_draft FOR UPDATE;
    IF h.max_count <> p_max_count THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','CONFLICT','message','Draft count changed'));
    END IF;
  ELSE
    SELECT * INTO h FROM public.live_photo_handoffs WHERE id=p_id AND owner_id=p_owner AND draft_id=p_draft FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','NOT_FOUND','message','Handoff not found'));
    END IF;
  END IF;
  IF h.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','EXPIRED','message','Handoff expired'));
  END IF;
  IF p_action = 'complete' THEN
    IF h.state = 'ready' AND h.pairs = p_pairs THEN
      NULL; -- Safe retry of the identical ordered batch only.
    ELSIF h.state <> 'pending' THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','CONFLICT','message','Handoff is not pending'));
    ELSE
      IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
        RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Invalid pairs'));
      END IF;
      IF jsonb_array_length(p_pairs) NOT BETWEEN 1 AND h.max_count THEN
        RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Too many or no pairs'));
      END IF;
      FOR pair IN SELECT value FROM jsonb_array_elements(p_pairs) LOOP
        IF jsonb_typeof(pair) <> 'object' OR jsonb_typeof(pair->'photoId') IS DISTINCT FROM 'number' OR jsonb_typeof(pair->'motionId') IS DISTINCT FROM 'number'
          OR (pair->>'photoId') !~ '^[1-9][0-9]{0,15}$' OR (pair->>'motionId') !~ '^[1-9][0-9]{0,15}$' THEN
          RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Invalid media IDs'));
        END IF;
        photo_id := (pair->>'photoId')::bigint; motion_id := (pair->>'motionId')::bigint;
        IF photo_id=motion_id OR photo_id=ANY(seen_ids) OR motion_id=ANY(seen_ids) THEN
          RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Duplicate media'));
        END IF;
        seen_ids := seen_ids || ARRAY[photo_id,motion_id];
        SELECT * INTO photo FROM public.media WHERE id=photo_id FOR SHARE;
        IF NOT FOUND THEN
          RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Media unavailable'));
        END IF;
        SELECT * INTO motion FROM public.media WHERE id=motion_id FOR SHARE;
        IF NOT FOUND THEN
          RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Media unavailable'));
        END IF;
        -- Protected upload receipts prove authenticated server provenance and
        -- pin canonical fields against later edits to legacy client-writable media.
        IF NOT EXISTS (SELECT 1 FROM public.live_photo_upload_receipts r WHERE r.media_id=photo_id AND r.owner_auth_id=p_owner AND r.object_key=photo.filename AND r.url=photo.url AND r.mime_type=photo.mime_type AND r.media_type=photo.type)
          OR NOT EXISTS (SELECT 1 FROM public.live_photo_upload_receipts r WHERE r.media_id=motion_id AND r.owner_auth_id=p_owner AND r.object_key=motion.filename AND r.url=motion.url AND r.mime_type=motion.mime_type AND r.media_type=motion.type) THEN
          RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Verified upload receipts required'));
        END IF;
        -- media-upload generates canonical kind/auth-owner/year/month/uuid keys.
        -- Neither an incoming URL nor an ID by itself establishes ownership.
        IF photo.type IS DISTINCT FROM 'image' OR motion.type IS DISTINCT FROM 'video'
          OR photo.mime_type IS NULL OR photo.mime_type NOT IN ('image/jpeg','image/heic','image/heif','image/png')
          OR motion.mime_type IS NULL OR motion.mime_type NOT IN ('video/quicktime','video/mov','video/mp4')
          OR photo.filename IS NULL OR motion.filename IS NULL
          OR split_part(photo.filename,'/',1) <> 'post-image' OR split_part(motion.filename,'/',1) <> 'post-video'
          OR split_part(photo.filename,'/',2) <> p_owner OR split_part(motion.filename,'/',2) <> p_owner
          OR array_length(string_to_array(photo.filename,'/'),1) <> 5 OR array_length(string_to_array(motion.filename,'/'),1) <> 5
          OR position('..' in photo.filename)>0 OR position('..' in motion.filename)>0
          OR photo.url IS NULL OR motion.url IS NULL OR photo.url NOT LIKE 'https://%' OR motion.url NOT LIKE 'https://%'
          OR photo.filesize IS NULL OR photo.filesize <= 0 OR motion.filesize IS NULL OR motion.filesize <= 0 THEN
          RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_MEDIA','message','Media must be owned photo and motion uploads'));
        END IF;
        assets_out := assets_out || jsonb_build_array(jsonb_build_object('photoId',photo_id,'motionId',motion_id,'url',photo.url,'livePhotoVideoUrl',motion.url,'mimeType',photo.mime_type,'width',photo.width,'height',photo.height));
      END LOOP;
      UPDATE public.live_photo_handoffs SET state='ready',pairs=p_pairs,assets=assets_out WHERE id=h.id RETURNING * INTO h;
    END IF;
  ELSIF p_action = 'consume' THEN
    IF p_request IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_REQUEST','message','Request ID required'));
    END IF;
    IF h.state='ready' THEN
      UPDATE public.live_photo_handoffs SET state='consumed',consume_request_id=p_request WHERE id=h.id AND state='ready' RETURNING * INTO h;
    ELSIF h.state <> 'consumed' OR h.consume_request_id IS DISTINCT FROM p_request THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','CONFLICT','message','Handoff cannot be consumed'));
    END IF;
  ELSIF p_action = 'cancel' THEN
    IF h.state='consumed' THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','CONFLICT','message','Handoff already consumed'));
    END IF;
    UPDATE public.live_photo_handoffs SET state='cancelled',pairs=NULL,assets=NULL WHERE id=h.id RETURNING * INTO h;
  END IF;
  result := jsonb_build_object('id',h.id,'draftId',h.draft_id,'state',h.state,'expiresAt',h.expires_at,'maxCount',h.max_count);
  IF p_action='consume' THEN result := result || jsonb_build_object('assets',h.assets); END IF;
  RETURN jsonb_build_object('ok',true,'data',result);
END;
$$;
REVOKE ALL ON FUNCTION public.live_photo_handoff_action(text,text,uuid,uuid,integer,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_photo_handoff_action(text,text,uuid,uuid,integer,jsonb,uuid) TO service_role;
