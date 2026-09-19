import { describe, expect, it } from 'vitest';
import { mergeSyncState, parseSyncPayload } from '../../../src/main/sync/merger';
import { DEFAULT_APPLICATION_WRITING_STYLES } from '../../../src/shared/personalization';

const emptyLearning = {
  candidates: [],
  rejections: [],
};

const emptyPersonalizationLearning = {
  candidates: [],
  preferences: [],
  rejections: [],
};

describe('sync merger', () => {
  it('unions dictionary terms and appends unseen history', () => {
    const remote = parseSyncPayload({
      dictionary: [
        { source: 'learned', term: 'UnTypo' },
        { source: 'manual', term: 'Nexaorion' },
      ],
      exportedAt: 200,
      history: [
        {
          createdAt: 20,
          id: 'remote-1',
          intent: 'transcription',
          language: 'zh-CN',
          outputText: 'hello',
          providerId: 'speech',
        },
      ],
      personalization: {
        applicationStyles: {
          ...DEFAULT_APPLICATION_WRITING_STYLES,
          office: 'casual',
        },
        learningEnabled: true,
      },
      profile: { displayName: 'Remote' },
    });
    const merged = mergeSyncState(
      {
        dictionary: [{ source: 'manual', term: 'UnTypo' }],
        dictionaryLearning: emptyLearning,
        personalization: {
          applicationStyles: DEFAULT_APPLICATION_WRITING_STYLES,
          learningEnabled: false,
        },
        personalizationLearning: emptyPersonalizationLearning,
        profile: { displayName: 'Local' },
        profileUpdatedAt: 100,
      },
      remote,
      [
        {
          createdAt: 10,
          id: 'local-1',
          intent: 'transcription',
          language: 'zh-CN',
          outputText: 'local',
          providerId: 'speech',
        },
      ],
    );

    expect(merged.dictionary).toEqual([
      { source: 'manual', term: 'UnTypo' },
      { source: 'manual', term: 'Nexaorion' },
    ]);
    expect(merged.history).toHaveLength(1);
    expect(merged.recordsMerged).toBe(1);
    expect(merged.personalization.applicationStyles.office).toBe('casual');
    expect(merged.profile).toEqual({ displayName: 'Remote' });
  });
});
