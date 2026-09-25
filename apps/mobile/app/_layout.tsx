// Register the iOS home-screen widgets + Live Activity (expo-widgets) on app
// boot: importing runs createWidget/createLiveActivity and this call wires the
// native backend into the shared sync layer. No-op off iOS.
import { registerDvntWidgets } from "../widgets/index";

registerDvntWidgets();

export * from '@dvnt/app/features/routes/screens/_layout';
export { default } from '@dvnt/app/features/routes/screens/_layout';
