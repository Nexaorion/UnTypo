import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PingResponse } from '../shared/ipc';
import './styles.css';

const App = () => {
  const [runtime, setRuntime] = useState<PingResponse | null>(null);

  useEffect(() => {
    let active = true;
    void window.untypo.ping().then((response) => {
      if (active) setRuntime(response);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="status-card">
        <p className="eyebrow">UnTypo Client</p>
        <h1>Electron runtime ready</h1>
        <p>
          {runtime
            ? `${runtime.appName} ${runtime.version} · ${runtime.platform}`
            : 'Connecting to the main process…'}
        </p>
      </section>
    </main>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
