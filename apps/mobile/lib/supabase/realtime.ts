// apps/mobile keeps its own supabase client (./client), so freshChannel must be
// bound to that instance — see the module doc in
// packages/app/lib/supabase/realtime.ts for why the binding is load-bearing.
// A plain re-export of that module would bind to @dvnt/supabase's client and
// sweep the wrong channel list.
import { makeFreshChannel } from "@dvnt/app/lib/supabase/realtime";

import { supabase } from "./client";

export const freshChannel = makeFreshChannel(supabase);
