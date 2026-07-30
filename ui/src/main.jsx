import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { IS_DESKTOP } from './constants/config'
import '@fontsource-variable/inter'
import './index.css'
import 'katex/dist/katex.min.css'
// Initialize i18n
import './i18n/config.js'

// Register service worker for PWA + Web Push support
// The Electron shell is already a local, always-online client and does not
// benefit from a PWA fetch proxy. Keeping a service worker there can turn a
// transient local-server restart into a blank navigation response.
if ('serviceWorker' in navigator && !IS_DESKTOP) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
