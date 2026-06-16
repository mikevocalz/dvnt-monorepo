// Stubs for deep react-native internals that don't exist in react-native-web
export default {}
export const NativeComponentRegistry = {
  get: () => null,
  setRuntimeConfigProvider: () => {},
}
export const codegenNativeComponent = () => null
export const ReactFabric = { createPortal: () => null }
