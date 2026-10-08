// Types/entry surface. `supabase` has the same shape on both platforms, so the
// web client provides the canonical types.
export {
  supabase,
  setBridgeAccessToken,
  setBridgeTokenMinter,
  setFunctionResponseObserver,
} from "./client.web";
