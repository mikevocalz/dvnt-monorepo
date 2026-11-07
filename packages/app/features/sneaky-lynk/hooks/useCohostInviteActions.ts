import { useCallback, useEffect, useRef } from "react";
import { getBridgeRequestEpoch } from "@dvnt/app/lib/supabase/client";
import { useRouter } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useMyAuthId, useRespondToCohostInvite, type LynkCohostInvite } from "@dvnt/app/lib/hooks/use-lynk-cohost-invites";
import { cohostInviteErrorMessage, cohostRoomRoute } from "../cohost-invite-policy";

/** No late navigation or feedback after an account switch or dismissed surface. */
export function useCohostInviteActions(platform: "web" | "native") {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const account = useAuthStore((s) => s.isAuthenticated ? `${s.user?.id}:${s.user?.authId}` : "");
  const { data: authId } = useMyAuthId();
  const response = useRespondToCohostInvite(authId ?? undefined);
  const scope = useRef({ account, mounted: true });
  const actionInFlight = useRef<object | null>(null);
  if (scope.current.account !== account) {
    scope.current = { account, mounted: true };
    actionInFlight.current = null;
  }
  useEffect(() => {
    scope.current.mounted = true;
    return () => { scope.current.mounted = false; };
  }, []);
  const mutate = response.mutate;
  const respond = useCallback((invite: LynkCohostInvite, action: "accept" | "decline") => {
    const owner = scope.current;
    const epoch = getBridgeRequestEpoch();
    const isCurrent = () => {
      const state = useAuthStore.getState();
      const currentAccount = state.isAuthenticated ? `${state.user?.id}:${state.user?.authId}` : "";
      return owner === scope.current && owner.mounted && !!owner.account && owner.account === currentAccount && getBridgeRequestEpoch() === epoch;
    };
    if (!authId || !isCurrent() || actionInFlight.current) return;
    const actionOwner = {};
    actionInFlight.current = actionOwner;
    mutate({ inviteId: invite.id, action }, {
      onSuccess: (result) => {
        if (!isCurrent()) return;
        if (result.status === "accepted") {
          showToast("success", "Co-host invite accepted", "Review your camera and microphone before joining.");
          router.push(cohostRoomRoute(result.roomId, platform));
        } else {
          showToast("info", "Invitation declined", "You can ask the host for a new invitation later.");
        }
      },
      onSettled: () => {
        if (actionInFlight.current === actionOwner) actionInFlight.current = null;
      },
      onError: (error) => {
        if (isCurrent()) showToast("error", "Couldn't respond", cohostInviteErrorMessage(error));
      },
    });
  }, [authId, mutate, platform, router, showToast]);
  const accept = useCallback((invite: LynkCohostInvite) => respond(invite, "accept"), [respond]);
  const decline = useCallback((invite: LynkCohostInvite) => respond(invite, "decline"), [respond]);
  return { accept, decline, pending: response.isPending, variables: response.variables };
}
