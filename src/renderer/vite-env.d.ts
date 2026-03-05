/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    novelic: import('../preload/preload').PreloadApi;
  }
}
