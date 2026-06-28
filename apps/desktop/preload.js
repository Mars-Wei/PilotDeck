'use strict';

// Minimal, safe bridge. contextIsolation is on and the renderer gets no Node
// access — only this allow-listed surface. Grows in P3 (tray actions, native
// notifications, etc.).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('opcbrainDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
