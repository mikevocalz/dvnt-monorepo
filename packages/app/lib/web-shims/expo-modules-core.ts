// Web stub for expo-modules-core — native-only package
export default {}

export class EventEmitter {
  addListener() { return { remove: () => {} } }
  removeAllListeners() {}
  emit() {}
}
export class NativeModule extends EventEmitter {}
export class SharedObject {}
export class SharedRef {}

export class UnavailabilityError extends Error {
  constructor(moduleName: string, propertyName: string) {
    super(`The method or property ${moduleName}.${propertyName} is not available on web.`)
    this.name = 'UnavailabilityError'
  }
}

export class CodedError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'CodedError'
  }
}

export function requireNativeModule(_name: string) { return {} }
export function requireOptionalNativeModule(_name: string) { return null }
export function registerWebModule(cls: any) { return cls }
export function createWebModule(cls: any) { return cls }
export const Platform = { OS: 'web' }
export const NativeModulesProxy = {}
export const uuid = { v4: () => Math.random().toString(36).slice(2) }

// ── Additional surface the shared screens reach on web ──────────────────────
export function requireNativeViewManager(_name?: string) {
  return () => null
}
export function requireNativeView(_name?: string) {
  return () => null
}
export async function reloadAppAsync(_reason?: string) {}
export function installOnUIRuntime() {}

export const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
} as const

const grantedPermission = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
  expires: 'never' as const,
}
export function createPermissionHook(_options?: any) {
  return () => [
    grantedPermission,
    async () => grantedPermission,
    async () => grantedPermission,
  ]
}
