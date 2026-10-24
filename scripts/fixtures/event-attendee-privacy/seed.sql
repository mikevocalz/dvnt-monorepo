-- Entirely invented records. IDs and URLs are local test markers, never users.
INSERT INTO media(id,url) SELECT n, 'https://avatars.invalid/synthetic-'||n FROM generate_series(1,10) n;
INSERT INTO users(id,auth_id,username,first_name,avatar_id,verified,followers_count) VALUES
  (1,'owner','fixture_owner','Owner',1,true,0),
  (2,'attendee','fixture_attendee','Attendee',2,true,0),
  (3,'friend','fixture_friend','Friend',3,true,0),
  (4,'ticket-holder','fixture_ticket_holder','Ticket',4,true,0),
  (5,'stranger','fixture_stranger','Stranger',5,true,0),
  (6,'admin','fixture_admin','Admin',6,true,0),
  (7,'editor','fixture_editor','Editor',7,true,0),
  (8,'pending','fixture_pending','Pending',8,true,0),
  (9,'scanner','fixture_scanner','Scanner',9,true,0),
  (10,'co-viewer','fixture_co_viewer','Viewer',10,true,0);
INSERT INTO "user"(id,name) SELECT auth_id,first_name FROM users;
INSERT INTO follows(follower_id,following_id) VALUES(2,3),(5,3);
INSERT INTO events(id,title,event_type,category,host_id,start_date,end_date,created_at,total_attendees,event_tz,visibility,status) VALUES
  (1,'Ordinary','party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (2,'Protected canonical','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (3,'Protected linked','virtual_session','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (4,'Protected opt in','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (5,'Ordinary kink','kink_fetish_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (6,'Ordinary bate','bate_session','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (7,'Ordinary virtual','virtual_session','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (8,'Ordinary NSFW','party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (9,'Sex party in title only',NULL,'other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (10,'Protected legacy null','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (11,'Private opted in','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','private','active'),
  (12,'Hidden opted in','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (13,'Future publication','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (14,'Cancelled opted in','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','cancelled'),
  (15,'Protected no friend','sex_party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (16,'Ordinary linked','party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active'),
  (17,'Type transition','party','other','owner',now()+interval '3 days',now()+interval '3 days 6 hours',now()-interval '10 days',9,'Etc/UTC','public','active');
UPDATE events SET lynk_room_id='00000000-0000-4000-8000-000000000003' WHERE id IN (3,16);
UPDATE events SET nsfw=true WHERE id=8;
UPDATE events SET is_hidden=true WHERE id=12;
UPDATE events SET publish_at=now()+interval '1 day' WHERE id=13;
INSERT INTO event_rsvps(event_id,user_id,status,created_at)
  SELECT e.id,u.auth_id,'going',now() FROM events e JOIN users u ON u.id IN (2,3)
  WHERE NOT(e.id=15 AND u.id=3);
INSERT INTO tickets(id,event_id,user_id,status) SELECT id,id,'ticket-holder','active' FROM events;
INSERT INTO event_co_organizers(event_id,user_id,role,accepted)
  SELECT e.id, v.user_id,v.role,v.accepted FROM events e CROSS JOIN
    (VALUES ('admin','admin',true),('editor','editor',true),('pending','admin',false),
      ('scanner','scanner',true),('co-viewer','viewer',true)) AS v(user_id,role,accepted);
INSERT INTO ticket_types(id,event_id,name,price_cents,quantity_total,quantity_sold,is_active)
  SELECT id,id,'Admission',1000,20,9,true FROM events;
