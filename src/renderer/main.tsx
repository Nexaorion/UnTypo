import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PingResponse } from '../shared/ipc';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';
import { Input } from './ui/input';
import { Popover } from './ui/popover';
import { Switch } from './ui/switch';
import { Tabs, type TabItem } from './ui/tabs';
import { ToastProvider, useToast } from './ui/toast';
import { Tooltip, TooltipProvider } from './ui/tooltip';
import './styles.css';

const SettingsIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" />
    <path d="M19.2 13.1a7.6 7.6 0 0 0 .05-1.1 7.6 7.6 0 0 0-.05-1.1l2-1.55-2-3.46-2.48 1a8.2 8.2 0 0 0-1.9-1.1L14.45 3h-4.9l-.37 2.79a8.2 8.2 0 0 0-1.9 1.1l-2.48-1-2 3.46 2 1.55A7.6 7.6 0 0 0 4.75 12c0 .37.02.74.05 1.1l-2 1.55 2 3.46 2.48-1a8.2 8.2 0 0 0 1.9 1.1L9.55 21h4.9l.37-2.79a8.2 8.2 0 0 0 1.9-1.1l2.48 1 2-3.46-2-1.55Z" />
  </svg>
);

const CopyIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <rect height="13" rx="2" width="13" x="8" y="8" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </svg>
);

const previewTabs: readonly TabItem[] = [
  {
    content: (
      <div className="preview-result">
        <span>Polished transcript</span>
        <p>Ship the smallest complete version, then listen to real usage.</p>
      </div>
    ),
    label: 'Transcript',
    value: 'transcript',
  },
  {
    content: (
      <div className="preview-result">
        <span>English translation</span>
        <p>Focus on the signal, preserve the intent, and remove the noise.</p>
      </div>
    ),
    label: 'Translation',
    value: 'translation',
  },
  {
    content: (
      <div className="preview-result">
        <span>Generated instruction</span>
        <p>Draft a concise project update with decisions and next actions.</p>
      </div>
    ),
    label: 'Instruction',
    value: 'instruction',
  },
];

const Preview = () => {
  const [runtime, setRuntime] = useState<PingResponse | null>(null);
  const [preserveClipboard, setPreserveClipboard] = useState(true);
  const [dictionaryTerm, setDictionaryTerm] = useState('UnTypo');
  const notify = useToast();

  useEffect(() => {
    let active = true;
    const ping = window.untypo?.ping;
    if (!ping) {
      setRuntime({ appName: 'UnTypo', platform: 'preview', version: '0.1.0' });
      return () => {
        active = false;
      };
    }
    void ping().then((response) => {
      if (active) setRuntime(response);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="preview-shell">
      <header className="preview-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            U
          </span>
          <div>
            <strong>UnTypo</strong>
            <small>Client foundation</small>
          </div>
        </div>
        <div className="runtime-status" data-testid="runtime-status">
          <span aria-hidden="true" />
          {runtime ? `${runtime.version} · ${runtime.platform}` : 'Connecting…'}
        </div>
      </header>

      <section className="preview-intro">
        <div>
          <h1>Interface preview</h1>
          <p>
            Accessible primitives for a quiet, background-first dictation
            client. 这里只预览组件，不包含业务页面
          </p>
        </div>
        <Tooltip label="Open visual settings">
          <IconButton aria-label="Open visual settings">
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </section>

      <div className="preview-workbench">
        <aside className="token-rail">
          <div>
            <h2>Foundation</h2>
            <p>Deep blue-black surfaces with high-contrast white actions</p>
          </div>
          <dl>
            <div>
              <dt>Radius</dt>
              <dd>10 / 14 / pill</dd>
            </div>
            <div>
              <dt>Motion</dt>
              <dd>150 ms</dd>
            </div>
            <div>
              <dt>Focus</dt>
              <dd>2 px white</dd>
            </div>
          </dl>
          <div className="palette" aria-label="Color palette">
            <span className="palette-ink" />
            <span className="palette-surface" />
            <span className="palette-border" />
            <span className="palette-white" />
          </div>
        </aside>

        <div className="component-stage">
          <section className="component-section">
            <div className="section-heading">
              <div>
                <h2>Actions & input</h2>
                <p>Text actions stay pill-shaped; icon actions stay circular</p>
              </div>
              <span>01</span>
            </div>

            <div className="button-row">
              <Button variant="primary">Start dictation</Button>
              <Button variant="secondary">Test connection</Button>
              <Button variant="ghost">Clear</Button>
              <Button variant="danger">Remove</Button>
              <Tooltip label="Copy generated result">
                <IconButton
                  aria-label="Copy generated result"
                  variant="secondary"
                >
                  <CopyIcon />
                </IconButton>
              </Tooltip>
            </div>

            <label className="field-preview">
              <span>Dictionary term</span>
              <Input
                aria-label="Dictionary term"
                onValueChange={setDictionaryTerm}
                value={dictionaryTerm}
              />
              <small>Terms are preserved exactly during transcription</small>
            </label>

            <Switch
              checked={preserveClipboard}
              data-testid="clipboard-switch"
              description="Restore only after successful paste when content is unchanged"
              label="Preserve clipboard"
              onCheckedChange={setPreserveClipboard}
            />
          </section>

          <section className="component-section">
            <div className="section-heading">
              <div>
                <h2>Layers & feedback</h2>
                <p>Focus-managed surfaces with short, restrained transitions</p>
              </div>
              <span>02</span>
            </div>

            <div className="button-row">
              <Dialog
                description="A focus-managed Base UI dialog with a Headless UI visual transition"
                title="Provider preview"
                triggerLabel="Open dialog"
              >
                <label className="field-preview">
                  <span>Display name</span>
                  <Input defaultValue="Primary OpenAI" />
                </label>
              </Dialog>
              <Popover title="Runtime status" triggerLabel="Open popover">
                <p className="popover-copy">
                  Recorder, provider pipeline, and Native Helper are connected
                  through isolated bridges
                </p>
              </Popover>
              <Button
                data-testid="toast-trigger"
                onClick={() =>
                  notify(
                    'Preview saved',
                    'The component state was updated locally.',
                  )
                }
                variant="secondary"
              >
                Show toast
              </Button>
            </div>
          </section>

          <section className="component-section component-section--tabs">
            <div className="section-heading">
              <div>
                <h2>Intent result</h2>
                <p>Arrow-key navigation and a clear selected state</p>
              </div>
              <span>03</span>
            </div>
            <Tabs items={previewTabs} />
          </section>
        </div>
      </div>
    </main>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <Preview />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
