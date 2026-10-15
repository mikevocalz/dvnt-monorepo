-- Delete expired member proximity points.
--
-- Reads already ignore rows past share_until, but the coordinates stayed in
-- the table until the member published or revoked again. This removes them
-- every 15 minutes. member_proximity_presence_share_until_idx serves the
-- range scan. Guarded the same way as the other cron migrations: a database
-- without pg_cron skips the schedule.
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('member-proximity-presence-purge')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'member-proximity-presence-purge',
      '*/15 * * * *',
      'delete from public.member_proximity_presence where share_until < now();'
    )$$;
  end if;
end $cron$;
