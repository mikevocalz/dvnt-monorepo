import createElement from 'react-native-web/dist/exports/createElement';
// Semantic RNW leaves isolate the NativeWind/native-only barrel. They do not
// implement or intercept navigation; the production shells own every action.
export const Main = (props: object) => createElement('main', props);
export const Nav = (props: object) => createElement('nav', props);
export const Header = (props: object) => createElement('header', props);
