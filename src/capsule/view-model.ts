import type { CapsuleErrorReason, CapsuleStatus } from '../shared/capsule-ipc';

interface CapsuleMessages {
  close: string;
  confirmAccept: string;
  confirmReject: string;
  confirmTitle: string;
  dictionaryAccept: string;
  dictionaryCancel: string;
  dictionaryDetail: (term: string) => string;
  dictionaryErrors: Record<
    'duplicate' | 'empty' | 'full' | 'too-long' | 'unavailable',
    string
  >;
  dictionaryModify: string;
  dictionaryReject: string;
  dictionarySave: string;
  dictionaryTitle: string;
  copy: string;
  emptyTitle: string;
  errorTitle: string;
  noSpeechTitle: string;
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
    noSpeechTitle: 'Did you say something?',
    errors: {
      configuration: 'Configure a speech recognition model before dictating.',
      empty: 'No speech was recognized. Please try again.',
      microphone: 'Check microphone access and your input device.',
      'no-speech': 'UnTypo did not detect speech. Please try again.',
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
    confirmTitle: 'Use this text?',
    confirmAccept: 'Use',
    confirmReject: 'Use original',
    dictionaryAccept: 'Add',
    dictionaryCancel: 'Cancel',
    dictionaryDetail: (term) => `“${term}” looks like a term you use often`,
    dictionaryErrors: {
      duplicate: 'This term is already in your dictionary.',
      empty: 'Enter a term before saving.',
      full: 'Your dictionary has reached its 1000-term limit.',
      'too-long': 'Keep the term within 128 characters.',
      unavailable: 'Could not add this term. Please try again.',
    },
    dictionaryModify: 'Edit',
    dictionaryReject: 'Reject',
    dictionarySave: 'Save',
    dictionaryTitle: 'Add to dictionary?',
  },
  'zh-CN': {
    close: '关闭',
    copy: '复制',
    emptyTitle: '没有听清',
    errorTitle: '处理失败',
    noSpeechTitle: '你好像没说话？',
    errors: {
      configuration: '请先在模型设置中配置语音识别模型',
      empty: '没有听清，请再说一次',
      microphone: '无法使用麦克风，请检查系统权限与输入设备',
      'no-speech': 'UnTypo 没有识别到人声，请重试',
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
    confirmTitle: '使用此文本？',
    confirmAccept: '使用',
    confirmReject: '使用原文',
    dictionaryAccept: '添加',
    dictionaryCancel: '取消',
    dictionaryDetail: (term) => `“${term}” 可能是你常用的专有词`,
    dictionaryErrors: {
      duplicate: '这个词已经在词典中了',
      empty: '请输入词条后再保存',
      full: '词典已达到 1000 条上限',
      'too-long': '词条不能超过 128 个字符',
      unavailable: '暂时无法添加，请稍后重试',
    },
    dictionaryModify: '修改',
    dictionaryReject: '拒绝',
    dictionarySave: '保存',
    dictionaryTitle: '添加到词典？',
  },
};

export interface CapsuleViewModel {
  ariaLive: 'assertive' | 'polite';
  closeLabel: string;
  confirmAcceptLabel?: string;
  confirmRejectLabel?: string;
  copyLabel: string;
  detail: string;
  dictionaryAcceptLabel?: string;
  dictionaryCancelLabel?: string;
  dictionaryModifyLabel?: string;
  dictionaryRejectLabel?: string;
  dictionarySaveLabel?: string;
  showClose: boolean;
  showConfirm: boolean;
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
      showConfirm: false,
      showCopy: false,
      title: copy.recordingTitle,
    };
  }
  if (status.type === 'processing') {
    return {
      ariaLive: 'polite',
      closeLabel: copy.close,
      copyLabel: copy.copy,
      detail: status.outputText?.trim() || copy.processingDetail,
      showClose: false,
      showConfirm: false,
      showCopy: false,
      title: copy.processingTitle,
    };
  }
  if (status.type === 'confirm') {
    return {
      ariaLive: 'polite',
      closeLabel: copy.close,
      confirmAcceptLabel: copy.confirmAccept,
      confirmRejectLabel: copy.confirmReject,
      copyLabel: copy.copy,
      detail: status.outputText,
      showClose: false,
      showConfirm: true,
      showCopy: false,
      title: `${copy.confirmTitle} · ${copy.intents[status.intent]}`,
    };
  }
  if (status.type === 'dictionary-suggestion') {
    return {
      ariaLive: 'polite',
      closeLabel: copy.close,
      copyLabel: copy.copy,
      detail: status.error
        ? copy.dictionaryErrors[status.error]
        : copy.dictionaryDetail(status.term),
      dictionaryAcceptLabel: copy.dictionaryAccept,
      dictionaryCancelLabel: copy.dictionaryCancel,
      dictionaryModifyLabel: copy.dictionaryModify,
      dictionaryRejectLabel: copy.dictionaryReject,
      dictionarySaveLabel: copy.dictionarySave,
      showClose: false,
      showConfirm: false,
      showCopy: false,
      title: copy.dictionaryTitle,
    };
  }
  if (status.type === 'error') {
    return {
      ariaLive: 'assertive',
      closeLabel: copy.close,
      copyLabel: copy.copy,
      detail: status.detail?.trim() || copy.errors[status.reason],
      showClose: true,
      showConfirm: false,
      showCopy: false,
      title:
        status.reason === 'empty'
          ? copy.emptyTitle
          : status.reason === 'no-speech'
            ? copy.noSpeechTitle
            : copy.errorTitle,
    };
  }
  return {
    ariaLive: 'polite',
    closeLabel: copy.close,
    copyLabel: copy.copy,
    detail: status.outputText,
    showClose: true,
    showConfirm: false,
    showCopy: status.delivery === 'copy',
    title:
      status.delivery === 'inserted'
        ? `${copy.successInserted} · ${copy.intents[status.intent]}`
        : copy.successCopy,
  };
};
