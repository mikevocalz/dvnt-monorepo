// Types/entry surface. authClient + the destructured hooks have the same shape
// on both platforms; the web client provides the canonical types.
export {
  authClient,
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
} from "./client.web";
