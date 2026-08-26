import { describe, expect, it } from 'vitest';
import { capsuleViewModel } from '../../src/capsule/view-model';

describe('capsuleViewModel', () => {
  it('maps recording and processing to compact Chinese status copy', () => {
    expect(
      capsuleViewModel({
        level: 0.4,
        locale: 'zh-CN',
        type: 'recording',
      }),
    ).toMatchObject({
      detail: '正在监听麦克风',
      showClose: false,
      showCopy: false,
      title: '正在录音',
    });

    expect(
      capsuleViewModel({ locale: 'zh-CN', type: 'processing' }),
    ).toMatchObject({
      detail: '正在转写并整理文字',
      showClose: false,
      showCopy: false,
      title: '处理中...',
    });
  });

  it('distinguishes inserted and copy fallback results', () => {
    expect(
      capsuleViewModel({
        delivery: 'inserted',
        intent: 'transcription',
        locale: 'zh-CN',
        outputText: '测试结果',
        type: 'success',
      }),
    ).toMatchObject({
      detail: '测试结果',
      showClose: true,
      showCopy: false,
      title: '已输入 · 转写结果',
    });

    expect(
      capsuleViewModel({
        delivery: 'copy',
        intent: 'translation',
        locale: 'en-US',
        outputText: 'Translated text',
        type: 'success',
      }),
    ).toMatchObject({
      detail: 'Translated text',
      showClose: true,
      showCopy: true,
      title: 'Could not insert automatically',
    });
  });

  it('uses assertive localized copy for every error reason', () => {
    expect(
      capsuleViewModel({
        detail: 'No microphone signal detected',
        locale: 'en-US',
        reason: 'microphone',
        type: 'error',
      }),
    ).toMatchObject({ detail: 'No microphone signal detected' });

    expect(
      capsuleViewModel({
        locale: 'zh-CN',
        reason: 'microphone',
        type: 'error',
      }),
    ).toMatchObject({
      ariaLive: 'assertive',
      detail: '无法使用麦克风，请检查系统权限与输入设备',
      showCopy: false,
      title: '处理失败',
    });

    expect(
      capsuleViewModel({
        locale: 'en-US',
        reason: 'empty',
        type: 'error',
      }),
    ).toMatchObject({
      detail: 'No speech was recognized. Please try again.',
      title: 'Nothing recognized',
    });
  });
});
