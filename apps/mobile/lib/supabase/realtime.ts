// Re-export, deliberately — not a separate binding.
//
// ./client is now a shim over @dvnt/supabase, so mobile and packages/app share
// one client instance. makeFreshChannel keeps its `seq` counter in the closure,
// so a second binding over the same client would run a second counter and could
// mint a topic that the first one has already used. One client, one binding.
export { freshChannel } from "@dvnt/app/lib/supabase/realtime";
