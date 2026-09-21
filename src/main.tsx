import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './I18nProvider';
import { PlayerProvider } from './player/PlayerProvider';
import { ToastProvider } from './toasts';
import './styles.css'; // global stylesheet

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <PlayerProvider>
          <App />
        </PlayerProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
