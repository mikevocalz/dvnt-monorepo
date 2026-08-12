/**
 * CallKeep module barrel export.
 *
 * ALL CallKeep interactions MUST go through this module.
 * Direct imports of 'react-native-callkeep' are FORBIDDEN outside this
 * directory (`packages/app/features/services/callkeep/`), which is now the
 * only copy — `apps/mobile/src/services/callkeep/` was a byte-identical fork.
 */

export {
  setupCallKeep,
  startOutgoingCall,
  showIncomingCall,
  endCall,
  endAllCalls,
  reportEndCall,
  reportOutgoingCallConnected,
  setCallActive,
  setMuted,
  updateDisplay,
  backToForeground,
  registerCallKeepListeners,
  persistCallMapping,
  getSessionIdFromUUID,
  getUUIDFromSessionId,
  clearCallMapping,
  CALLKEEP_CONSTANTS,
} from "./callkeep";

export type {
  StartOutgoingCallParams,
  ShowIncomingCallParams,
  CallKeepAnswerHandler,
  CallKeepEndHandler,
  CallKeepDidDisplayHandler,
  CallKeepToggleMuteHandler,
} from "./callkeep";

export { useCallKeepCoordinator } from "./useCallKeepCoordinator";
export { NotificationListener } from "./NotificationListener";

export {
  CALL_DEBUG,
  callTrace,
  callTraceWarn,
  callTraceError,
  setCallDebugContext,
  clearCallDebugContext,
} from "./call-debug";
