/**
 * NativeWind v5 / react-native-css wrappers for `@expo/html-elements`
 * (nativewind.dev/v5/guides/third-party-components).
 *
 * NativeWind auto-wires the core React Native components only. A third-party
 * component is just a function receiving props, so `className` arrives as an
 * unknown prop and is dropped — no error, no warning, the utility simply never
 * applies. That is why `<Main className="flex-1">` had no flex, collapsed to
 * zero height, and took the whole Settings body with it.
 *
 * This is the ONLY place `useCssElement` is called. Import these instead of
 * `@expo/html-elements` directly; the semantic element (and its web landmark /
 * native a11y role) is preserved, it just also understands `className` now.
 *
 * Wrappers are written per-component rather than through a generic helper:
 * `useCssElement`'s prop-mapping type collapses when abstracted generically.
 */

import React from "react";
import { useCssElement } from "react-native-css";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";
import { BottomSheetView as GBottomSheetView } from "@gorhom/bottom-sheet";
import { LinearGradient as EXLinearGradient } from "expo-linear-gradient";
import {
  A as EA,
  Article as EArticle,
  Footer as EFooter,
  H1 as EH1,
  H2 as EH2,
  H3 as EH3,
  Header as EHeader,
  Main as EMain,
  Nav as ENav,
  P as EP,
  Section as ESection,
} from "@expo/html-elements";

type CN = { className?: string };

export const Main = (props: React.ComponentProps<typeof EMain> & CN) =>
  useCssElement(EMain, props, { className: "style" });
Main.displayName = "CSS(Main)";

export const Section = (props: React.ComponentProps<typeof ESection> & CN) =>
  useCssElement(ESection, props, { className: "style" });
Section.displayName = "CSS(Section)";

export const Article = (props: React.ComponentProps<typeof EArticle> & CN) =>
  useCssElement(EArticle, props, { className: "style" });
Article.displayName = "CSS(Article)";

export const Nav = (props: React.ComponentProps<typeof ENav> & CN) =>
  useCssElement(ENav, props, { className: "style" });
Nav.displayName = "CSS(Nav)";

export const Header = (props: React.ComponentProps<typeof EHeader> & CN) =>
  useCssElement(EHeader, props, { className: "style" });
Header.displayName = "CSS(Header)";

export const Footer = (props: React.ComponentProps<typeof EFooter> & CN) =>
  useCssElement(EFooter, props, { className: "style" });
Footer.displayName = "CSS(Footer)";

export const A = (props: React.ComponentProps<typeof EA> & CN) =>
  useCssElement(EA, props, { className: "style" });
A.displayName = "CSS(A)";

export const H1 = (props: React.ComponentProps<typeof EH1> & CN) =>
  useCssElement(EH1, props, { className: "style" });
H1.displayName = "CSS(H1)";

export const H2 = (props: React.ComponentProps<typeof EH2> & CN) =>
  useCssElement(EH2, props, { className: "style" });
H2.displayName = "CSS(H2)";

export const H3 = (props: React.ComponentProps<typeof EH3> & CN) =>
  useCssElement(EH3, props, { className: "style" });
H3.displayName = "CSS(H3)";

export const P = (props: React.ComponentProps<typeof EP> & CN) =>
  useCssElement(EP, props, { className: "style" });
P.displayName = "CSS(P)";

// ---- other third-party components this app styles with className ------------
// Same rule as above: NativeWind only auto-wires core React Native components.
// `SafeAreaView` is the one that hurt — 32 screens open with
// `<SafeAreaView className="flex-1 …">`, and with the class dropped every one of
// them collapsed to zero height.

export const SafeAreaView = (
  props: React.ComponentProps<typeof RNSafeAreaView> & CN,
) => useCssElement(RNSafeAreaView, props, { className: "style" });
SafeAreaView.displayName = "CSS(SafeAreaView)";

export const BottomSheetView = (
  props: React.ComponentProps<typeof GBottomSheetView> & CN,
) =>
  useCssElement(
    GBottomSheetView as React.ComponentType<object>,
    props,
    { className: "style" } as never,
  );
BottomSheetView.displayName = "CSS(BottomSheetView)";

export const LinearGradient = (
  props: React.ComponentProps<typeof EXLinearGradient> & CN,
) => useCssElement(EXLinearGradient, props, { className: "style" });
LinearGradient.displayName = "CSS(LinearGradient)";
