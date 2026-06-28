/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = import.meta.env.VITE_IS_PLATFORM === 'true';

/**
 * Matches server OPCBRAIN_DISABLE_LOCAL_AUTH (injected in vite.config.js).
 */
export const DISABLE_LOCAL_AUTH = import.meta.env.VITE_DISABLE_LOCAL_AUTH === 'true';

/**
 * Environment Flag: Is Desktop
 * True when running inside the Electron desktop shell (apps/desktop), which
 * exposes `window.opcbrainDesktop` via its preload. Used to drop UI that does
 * not apply on desktop (e.g. the browser-only voice assistant).
 */
export const IS_DESKTOP =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { opcbrainDesktop?: { isDesktop?: boolean } }).opcbrainDesktop?.isDesktop);