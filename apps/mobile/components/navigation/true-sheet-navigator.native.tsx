import { withLayoutContext } from "expo-router";
import { createTrueSheetNavigator } from "@lodev09/react-native-true-sheet/navigation";

const { Navigator } = createTrueSheetNavigator();

export default withLayoutContext(Navigator);
