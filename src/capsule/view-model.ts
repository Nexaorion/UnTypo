import type { CapsuleErrorReason, CapsuleStatus } from '../shared/capsule-ipc';

interface CapsuleMessages {
  close: string;
  copy: string;
  emptyTitle: string;
  errorTitle: string;
  errors: Record<CapsuleErrorReason, string>;
  intents: Record<'instruction' | 'transcription' | 'translation', string>;
  processingDetail: string;
  processingTitle: string;
  recordingDetail: string;
  recordingTitle: string;
  successCopy: string;
  successInserted: string;
}

const messages: Record<'en-US' | 'zh-CN', CapsuleMessages> = {
  'en-US': {
    close: 'Close',
    copy: 'Copy',
    emptyTitle: 'Nothing recognized',
    errorTitle: 'Could not process dictation',
    errors: {
      configuration: 'Configure a speech recognition model before dictating.',
      empty: 'No speech was recognized. Please try again.',
      microphone: 'Check microphone access and your input device.',
      provider: 'Check the model configuration and network connection.',
      unknown: 'Something went wrong. Please try again.',
    },
    intents: {
      instruction: 'Instruction',
      transcription: 'Transcription',
      translation: 'Translation',
    },
    processingDetail: 'Transcribing and preparing your text',
    processingTitle: 'Processing...',
    recordingDetail: 'Listening to your microphone',
    recordingTitle: 'Recording',
    successCopy: 'Could not insert automatically',
    successInserted: 'Inserted',
  },
  'zh-CN': {
    close: '关闭',
    copy: '复制',
    emptyTitle: '没有听清',
    errorTitle: '处理失败',
    errors: {
      configuration: '请先在模型设置中配置语音识别模型',
      empty: '没有听清，请再说一次',
      microphone: '无法使用麦克风，请检查系统权限与输入设备',
      provider: '转写失败，请检查模型配置与网络',
      unknown: '处理失败，请稍后重试',
    },
    intents: {
      instruction: '指令结果',
      transcription: '转写结果',
      translation: '翻译结果',
    },
    processingDetail: '正在转写并整理文字',
    processingTitle: '处理中...',
    recordingDetail: '正在监听麦克风',
    recordingTitle: '正在录音',
    successCopy: '未能自动输入，结果已保留',
    successInserted: '已输入',
  },
};

export interface CapsuleViewModel {
  ariaLive: 'assertive' | 'polite';
  closeLabel: string;
  copyLabel: string;
  detail: string;
  showClose: boolean;
  showCopy: boolean;
  title: string;
}

export const capsuleViewModel = (status: CapsuleStatus): CapsuleViewModel => {
  const copy = messages[status.locale];
  if (status.type === 'recording') {
    return {
      ariaLive: 'polite',
      closeLabel: copy.close,
      copyLabel: copy.copy,
      detail: copy.recordingDetail,
      showClose: false,
      showCopy: false,
      title: copy.recordingTitle,
    };
  }
  if (status.type === 'processing') {
    return {
      ariaLive: 'polite',
      closeLabel: copy.close,
      copyLabel: copy.copy,
      detail: copy.processingDetail,
      showClose: false,
      showCopy: false,
      title: copy.processingTitle,
    };
  }
  if (status.type === 'error') {
    return {
      ariaLive: 'assertive',
      closeLabel: copy.close,
      copyLabel: copy.copy,
      detail: status.detail?.trim() || copy.errors[status.reason],
      showClose: true,
      showCopy: false,
      title: status.reason === 'empty' ? copy.emptyTitle : copy.errorTitle,
    };
  }
  return {
    ariaLive: 'polite',
    closeLabel: copy.close,
    copyLabel: copy.copy,
    detail: status.outputText,
    showClose: true,
    showCopy: status.delivery === 'copy',
    title:
      status.delivery === 'inserted'
        ? `${copy.successInserted} · ${copy.intents[status.intent]}`
        : copy.successCopy,
  };
};
