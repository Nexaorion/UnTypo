import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CapsuleResult } from '../shared/capsule-ipc';
import './styles.css';

const intentLabels = {
  instruction: 'Instruction',
  transcription: 'Transcription',
  translation: 'Translation',
} as const;

const Capsule = () => {
  const [result, setResult] = useState<CapsuleResult>();

  useEffect(() => window.capsule.onResult(setResult), []);

  return (
    <main
      className="capsule"
      onPointerEnter={() => window.capsule.setInteractive(true)}
      onPointerLeave={() => window.capsule.setInteractive(false)}
    >
      <div className="capsule-copy">
        <span>{result ? intentLabels[result.intent] : 'UnTypo'}</span>
        <p>{result?.outputText ?? 'Preparing result…'}</p>
      </div>
      <div className="capsule-actions">
        <button onClick={() => window.capsule.copy()} type="button">
          Copy
        </button>
        <button
          aria-label="Close"
          className="capsule-close"
          onClick={() => window.capsule.close()}
          type="button"
        >
          ×
        </button>
      </div>
    </main>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Capsule />
  </StrictMode>,
);
