import 'dotenv/config'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } })
const m = await pool.query("select id,username,email,banned_at from public.users order by created_at desc nulls last limit 3")
console.log('members:', m.rows.map((r:any)=>`${r.username}(${r.banned_at?'banned':'active'})`).join(', '))
const e = await pool.query("select id,title,total_attendees from public.events order by start_date desc nulls last limit 3")
console.log('events:', e.rows.map((r:any)=>`${r.title}/${r.total_attendees}`).join(', '))
const s = await pool.query("select (select count(*) from public.users) u, (select count(*) from public.events) ev")
console.log('counts:', s.rows[0])
await pool.end(); process.exit(0)
