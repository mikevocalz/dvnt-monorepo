const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
const {issuerSql}=require('./issuance.cjs');
const ROOT=resolve(__dirname,'../../..');const read=p=>readFileSync(resolve(ROOT,p),'utf8');
function functionSql(file,name){const text=read(file);const re=new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.'+name+'\\s*\\(','i');const match=re.exec(text);assert.ok(match,name);const from=text.slice(match.index);const delimiter=/\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(from);assert.ok(delimiter);const open=delimiter.index;const end=from.indexOf(delimiter[0],open+delimiter[0].length);return from.slice(0,end+delimiter[0].length+1);}
function sourceSchemaSql(){return [read('scripts/fixtures/settlement/replacement-schema.sql'),
functionSql('apps/mobile/supabase/migrations/20261021144500_paid_ticket_issuance_atomic.sql','ticket_hold_create_atomic'),
`ALTER TABLE public.orders ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.carts ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE public.order_timeline(order_id uuid,type text);`,
issuerSql(),
functionSql('apps/mobile/supabase/migrations/20261031142216_repeat_purchase_tier_limits.sql','ticket_purchase_hold_atomic'),
functionSql('apps/mobile/supabase/migrations/20261106160919_cart_hold_inactive_tiers.sql','cart_create_hold'),
functionSql('apps/mobile/supabase/migrations/20261009100000_addon_capacity_counts_variants_and_holds.sql','addon_available'),
functionSql('apps/mobile/supabase/migrations/20261009100000_addon_capacity_counts_variants_and_holds.sql','addon_variant_available')].join('\n');}
module.exports={sourceSchemaSql,functionSql};
