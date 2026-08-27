import { app } from 'electron';
import {
  autoUpdater,
  type AppUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
} from 'electron-updater';
import type { ClientUpdateSnapshot } from '../../shared/ipc.js';
import type { DiagnosticCollector } from '../diagnostics/collector.js';
import type { UpdatePolicy } from '../storage/configuration.js';

const HAZEL_BASE_URL = 'https://update.untypo.org';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const STARTUP_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface HazelRelease {
  name: string;
  notes?: string;
  pub_date: string;
  url: string;
}

interface ApplicationUpdateServiceOptions {
  diagnostics: DiagnosticCollector;
  fetchImplementation?: typeof fetch;
  isPackaged?: boolean;
  now?: () => number;
  onChanged: (snapshot: ClientUpdateSnapshot) => void;
  platform?: NodeJS.Platform;
  updater?: AppUpdater;
  version?: string;
}

interface ParsedVersion {
  core: readonly [number, number, number];
  prerelease: readonly string[];
}

const parseVersion = (value: string): ParsedVersion | undefined => {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      value.trim(),
    );
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return {
    core: [major, minor, patch],
    prerelease: match[4]?.split('.') ?? [],
  };
};

const compareIdentifier = (left: string, right: string): number => {
  const leftNumber = /^\d+$/u.test(left) ? Number(left) : undefined;
  const rightNumber = /^\d+$/u.test(right) ? Number(right) : undefined;
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return Math.sign(leftNumber - rightNumber);
  }
  if (leftNumber !== undefined) return -1;
  if (rightNumber !== undefined) return 1;
  return left.localeCompare(right, 'en');
};

export const isNewerVersion = (candidate: string, current: string): boolean => {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.core.length; index += 1) {
    const difference = (next.core[index] ?? 0) - (installed.core[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  if (next.prerelease.length === 0) return installed.prerelease.length > 0;
  if (installed.prerelease.length === 0) return false;
  const length = Math.max(next.prerelease.length, installed.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = next.prerelease[index];
    const right = installed.prerelease[index];
    if (left === undefined) return false;
    if (right === undefined) return true;
    const difference = compareIdentifier(left, right);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

const normalizeVersion = (value: string): string =>
  value.trim().replace(/^v(?=\d)/u, '');

const parseHazelRelease = (value: unknown): HazelRelease => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Hazel returned an invalid response');
  }
  const release = value as Record<string, unknown>;
  if (
    typeof release.name !== 'string' ||
    typeof release.pub_date !== 'string' ||
    typeof release.url !== 'string' ||
    (release.notes !== undefined &&
      release.notes !== null &&
      typeof release.notes !== 'string')
  ) {
    throw new Error('Hazel returned an invalid response');
  }
  const url = new URL(release.url);
  if (url.protocol !== 'https:' || !parseVersion(release.name)) {
    throw new Error('Hazel returned an invalid release');
  }
  return {
    name: release.name,
    ...(typeof release.notes === 'string' ? { notes: release.notes } : {}),
    pub_date: release.pub_date,
    url: release.url,
  };
};

export class ApplicationUpdateService {
  readonly #diagnostics: DiagnosticCollector;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #onChanged: (snapshot: ClientUpdateSnapshot) => void;
  readonly #supported: boolean;
  readonly #updater: AppUpdater;
  readonly #version: string;
  #checkPromise?: Promise<ClientUpdateSnapshot>;
  #downloadPromise?: Promise<ClientUpdateSnapshot>;
  #interval?: NodeJS.Timeout;
  #policy: UpdatePolicy = { autoCheck: true, autoDownload: true };
  #startupTimer?: NodeJS.Timeout;
  #state: ClientUpdateSnapshot;

  constructor(options: ApplicationUpdateServiceOptions) {
    this.#diagnostics = options.diagnostics;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#onChanged = options.onChanged;
    this.#updater = options.updater ?? autoUpdater;
    this.#version = options.version ?? app.getVersion();
    this.#supported =
      (options.isPackaged ?? app.isPackaged) &&
      (options.platform ?? process.platform) === 'win32';
    this.#state = {
      currentVersion: this.#version,
      status: this.#supported ? 'idle' : 'disabled',
      supported: this.#supported,
    };

    this.#updater.autoDownload = false;
    this.#updater.autoInstallOnAppQuit = false;
    this.#updater.allowDowngrade = false;
    this.#updater.allowPrerelease = false;
    this.#updater.logger = {
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    };
    this.#updater.on('download-progress', this.handleDownloadProgress);
    this.#updater.on('update-downloaded', this.handleUpdateDownloaded);
    this.#updater.on('error', this.handleUpdaterError);
  }

  start(policy: UpdatePolicy): void {
    this.#policy = structuredClone(policy);
    this.reschedule();
  }

  configure(policy: UpdatePolicy): void {
    const shouldStartDownload =
      !this.#policy.autoDownload &&
      policy.autoDownload &&
      this.#state.status === 'available';
    this.#policy = structuredClone(policy);
    this.reschedule();
    if (shouldStartDownload) void this.downloadUpdate();
  }

  snapshot(): ClientUpdateSnapshot {
    return structuredClone(this.#state);
  }

  async checkForUpdates(): Promise<ClientUpdateSnapshot> {
    if (
      !this.#supported ||
      this.#state.status === 'downloaded' ||
      this.#state.status === 'downloading'
    ) {
      return this.snapshot();
    }
    this.#checkPromise ??= this.performCheck().finally(() => {
      this.#checkPromise = undefined;
    });
    return this.#checkPromise;
  }

  async downloadUpdate(): Promise<ClientUpdateSnapshot> {
    if (!this.#supported || this.#state.status === 'downloaded') {
      return this.snapshot();
    }
    if (!this.#state.availableVersion) return this.checkForUpdates();
    this.#downloadPromise ??= this.performDownload().finally(() => {
      this.#downloadPromise = undefined;
    });
    return this.#downloadPromise;
  }

  isReadyToInstall(): boolean {
    return this.#state.status === 'downloaded';
  }

  quitAndInstall(): void {
    if (!this.isReadyToInstall()) return;
    this.#updater.quitAndInstall(false, true);
  }

  stop(): void {
    this.clearSchedule();
    this.#updater.off('download-progress', this.handleDownloadProgress);
    this.#updater.off('update-downloaded', this.handleUpdateDownloaded);
    this.#updater.off('error', this.handleUpdaterError);
  }

  private readonly handleDownloadProgress = (progress: ProgressInfo): void => {
    if (this.#state.status !== 'downloading') return;
    this.setState({
      ...this.#state,
      progressPercent: Math.max(0, Math.min(100, progress.percent)),
    });
  };

  private readonly handleUpdateDownloaded = (
    event: UpdateDownloadedEvent,
  ): void => {
    this.setState({
      availableVersion: normalizeVersion(event.version),
      currentVersion: this.#version,
      ...(this.#state.lastCheckedAt
        ? { lastCheckedAt: this.#state.lastCheckedAt }
        : {}),
      progressPercent: 100,
      status: 'downloaded',
      supported: true,
    });
    this.#diagnostics.log({
      context: { version: normalizeVersion(event.version) },
      message: 'Application update downloaded',
      scope: 'app.update',
    });
  };

  private readonly handleUpdaterError = (): void => {
    if (this.#state.status !== 'downloading') return;
    this.setError('UPDATE_DOWNLOAD_FAILED');
  };

  private async performCheck(): Promise<ClientUpdateSnapshot> {
    this.setState({ ...this.#state, status: 'checking' });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      let response: Response;
      try {
        response = await this.#fetch(
          `${HAZEL_BASE_URL}/update/win32/${encodeURIComponent(this.#version)}`,
          {
            headers: { accept: 'application/json' },
            redirect: 'follow',
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      const checkedAt = this.#now();
      if (response.status === 204) {
        this.setState({
          currentVersion: this.#version,
          lastCheckedAt: checkedAt,
          status: 'up-to-date',
          supported: true,
        });
        return this.snapshot();
      }
      if (!response.ok) {
        throw new Error(`Hazel request failed with status ${response.status}`);
      }
      const release = parseHazelRelease(await response.json());
      const availableVersion = normalizeVersion(release.name);
      if (!isNewerVersion(availableVersion, this.#version)) {
        this.setState({
          currentVersion: this.#version,
          lastCheckedAt: checkedAt,
          status: 'up-to-date',
          supported: true,
        });
        return this.snapshot();
      }

      this.setState({
        availableVersion,
        currentVersion: this.#version,
        lastCheckedAt: checkedAt,
        status: 'available',
        supported: true,
      });
      this.#diagnostics.log({
        context: { version: availableVersion },
        message: 'Application update available',
        scope: 'app.update',
      });
      if (this.#policy.autoDownload) void this.downloadUpdate();
      return this.snapshot();
    } catch (error) {
      this.logFailure('Update discovery failed', error);
      this.setError('UPDATE_CHECK_FAILED');
      return this.snapshot();
    }
  }

  private async performDownload(): Promise<ClientUpdateSnapshot> {
    const expectedVersion = this.#state.availableVersion;
    if (!expectedVersion) return this.snapshot();
    this.setState({
      ...this.#state,
      progressPercent: 0,
      status: 'downloading',
    });
    try {
      const result = await this.#updater.checkForUpdates();
      const metadataVersion = normalizeVersion(
        result?.updateInfo.version ?? '',
      );
      if (
        !result?.isUpdateAvailable ||
        metadataVersion !== expectedVersion ||
        !isNewerVersion(metadataVersion, this.#version)
      ) {
        throw new Error('Release metadata does not match Hazel discovery');
      }
      await this.#updater.downloadUpdate();
      return this.snapshot();
    } catch (error) {
      this.logFailure('Update download failed', error);
      this.setError('UPDATE_DOWNLOAD_FAILED');
      return this.snapshot();
    }
  }

  private reschedule(): void {
    this.clearSchedule();
    if (!this.#supported || !this.#policy.autoCheck) return;
    this.#startupTimer = setTimeout(() => {
      void this.checkForUpdates();
    }, STARTUP_DELAY_MS);
    this.#startupTimer.unref?.();
    this.#interval = setInterval(() => {
      void this.checkForUpdates();
    }, UPDATE_INTERVAL_MS);
    this.#interval.unref?.();
  }

  private clearSchedule(): void {
    if (this.#startupTimer) clearTimeout(this.#startupTimer);
    if (this.#interval) clearInterval(this.#interval);
    this.#startupTimer = undefined;
    this.#interval = undefined;
  }

  private setError(errorMessage: string): void {
    this.setState({
      ...this.#state,
      errorMessage,
      status: 'error',
    });
  }

  private setState(state: ClientUpdateSnapshot): void {
    this.#state = structuredClone(state);
    this.#onChanged(this.snapshot());
  }

  private logFailure(message: string, error: unknown): void {
    this.#diagnostics.log({
      context: { errorName: error instanceof Error ? error.name : 'Error' },
      level: 'warning',
      message,
      scope: 'app.update',
    });
  }
}
