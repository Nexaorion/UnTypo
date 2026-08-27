import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CapsuleStatus } from '../shared/capsule-ipc';
import './styles.css';
import { capsuleViewModel } from './view-model';

const waveformShape = [0.45, 0.72, 1, 0.64, 0.86, 0.56, 0.36] as const;

const RecordingWave = ({ level }: { level: number }) => {
  const amplitude = 0.2 + Math.max(0, Math.min(1, level)) * 0.8;
  return (
    <div aria-hidden="true" className="recording-visual">
      <span className="recording-dot" />
      <div className="waveform">
        {waveformShape.map((shape, index) => (
          <span
            className="waveform-bar"
            key={index}
            style={{
              height: `${String(Math.round(6 + shape * amplitude * 22))}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const ProcessingVisual = () => (
  <div aria-hidden="true" className="processing-visual">
    <span />
    <span />
    <span />
  </div>
);

const SuccessVisual = () => (
  <div aria-hidden="true" className="terminal-visual terminal-success">
    <CheckCircleRoundedIcon />
  </div>
);

const ErrorVisual = () => (
  <div aria-hidden="true" className="terminal-visual terminal-error">
    <ErrorRoundedIcon />
  </div>
);

const DictionaryVisual = () => (
  <div aria-hidden="true" className="terminal-visual terminal-dictionary">
    <AutoAwesomeRoundedIcon />
  </div>
);

const DictionarySuggestion = ({
  status,
  viewModel,
}: {
  status: Extract<CapsuleStatus, { type: 'dictionary-suggestion' }>;
  viewModel: ReturnType<typeof capsuleViewModel>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(status.term);
  const input = useRef<HTMLInputElement>(null);

  const beginEditing = () => {
    setEditing(true);
    window.capsule.dictionaryFocus();
    requestAnimationFrame(() => input.current?.focus());
  };

  const cancelEditing = () => {
    setDraft(status.term);
    setEditing(false);
  };

  const submit = () => window.capsule.dictionaryAccept(draft);

  return editing ? (
    <form
      className="dictionary-suggestion-edit"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="dictionary-suggestion-field">
        <input
          aria-label={viewModel.title}
          disabled={status.submitting}
          maxLength={128}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancelEditing();
          }}
          ref={input}
          value={draft}
        />
      </div>
      <div className="capsule-actions">
        <button disabled={status.submitting} type="submit">
          {viewModel.dictionarySaveLabel}
        </button>
        <button
          className="capsule-secondary"
          disabled={status.submitting}
          onClick={cancelEditing}
          type="button"
        >
          {viewModel.dictionaryCancelLabel}
        </button>
        <button
          className="capsule-secondary"
          disabled={status.submitting}
          onClick={() => window.capsule.dictionaryReject()}
          type="button"
        >
          {viewModel.dictionaryRejectLabel}
        </button>
      </div>
    </form>
  ) : (
    <div className="capsule-actions">
      <button
        disabled={status.submitting}
        onClick={() => window.capsule.dictionaryAccept(status.term)}
        type="button"
      >
        {viewModel.dictionaryAcceptLabel}
      </button>
      <button
        className="capsule-secondary"
        disabled={status.submitting}
        onClick={beginEditing}
        type="button"
      >
        {viewModel.dictionaryModifyLabel}
      </button>
      <button
        className="capsule-secondary"
        disabled={status.submitting}
        onClick={() => window.capsule.dictionaryReject()}
        type="button"
      >
        {viewModel.dictionaryRejectLabel}
      </button>
    </div>
  );
};

const Capsule = () => {
  const [status, setStatus] = useState<CapsuleStatus>();

  useEffect(() => {
    const unsubscribe = window.capsule.onUpdate(setStatus);
    window.capsule.ready();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status) document.documentElement.lang = status.locale;
  }, [status]);

  if (!status) return null;
  const viewModel = capsuleViewModel(status);
  const terminal = status.type === 'error' || status.type === 'success';
  const confirmMode = status.type === 'confirm';
  const dictionaryMode = status.type === 'dictionary-suggestion';

  return (
    <main
      aria-live={viewModel.ariaLive}
      className="capsule"
      data-status={status.type}
      onPointerEnter={() =>
        (terminal || confirmMode || dictionaryMode) &&
        window.capsule.setInteractive(true)
      }
      onPointerLeave={() =>
        (terminal || confirmMode || dictionaryMode) &&
        window.capsule.setInteractive(false)
      }
      role="status"
    >
      {status.type === 'recording' ? (
        <RecordingWave level={status.level} />
      ) : status.type === 'processing' ? (
        <ProcessingVisual />
      ) : status.type === 'success' ? (
        <SuccessVisual />
      ) : status.type === 'confirm' ? (
        <SuccessVisual />
      ) : status.type === 'dictionary-suggestion' ? (
        <DictionaryVisual />
      ) : (
        <ErrorVisual />
      )}

      <div className="capsule-copy">
        <span>{viewModel.title}</span>
        <p>{viewModel.detail}</p>
      </div>

      {dictionaryMode ? (
        <DictionarySuggestion
          key={status.term}
          status={status}
          viewModel={viewModel}
        />
      ) : confirmMode ? (
        <div className="capsule-actions">
          <button onClick={() => window.capsule.confirm()} type="button">
            {viewModel.confirmAcceptLabel}
          </button>
          <button
            onClick={() => window.capsule.reject()}
            type="button"
            className="capsule-secondary"
          >
            {viewModel.confirmRejectLabel}
          </button>
        </div>
      ) : terminal ? (
        <div className="capsule-actions">
          {viewModel.showCopy ? (
            <button onClick={() => window.capsule.copy()} type="button">
              {viewModel.copyLabel}
            </button>
          ) : null}
          {viewModel.showClose ? (
            <button
              aria-label={viewModel.closeLabel}
              className="capsule-close"
              onClick={() => window.capsule.close()}
              type="button"
            >
              <CloseRoundedIcon aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Capsule />
  </StrictMode>,
);
