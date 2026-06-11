import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SessionProvider } from '../types/app';
import {
  createRafNotifyScheduler,
  patchMergedStreamingMessage,
  useSessionStore,
  type NormalizedMessage,
  type SessionSlot,
} from './useSessionStore';

const PROVIDER = 'pilotdeck' as SessionProvider;

function makeSlot(overrides: Partial<SessionSlot> = {}): SessionSlot {
  return {
    serverMessages: [],
    realtimeMessages: [],
    activityMessages: [],
    merged: [],
    _lastServerRef: [],
    _lastRealtimeRef: [],
    status: 'streaming',
    fetchedAt: 0,
    lastError: null,
    total: 0,
    hasMore: false,
    offset: 0,
    tokenUsage: null,
    ...overrides,
  };
}

function streamingMessage(sessionId: string, content: string): NormalizedMessage {
  return {
    id: `__streaming_${sessionId}`,
    sessionId,
    timestamp: '2026-05-28T00:00:00.000Z',
    provider: PROVIDER,
    kind: 'stream_delta',
    content,
  };
}

describe('patchMergedStreamingMessage', () => {
  it('updates merged content in place without replacing the merged array', () => {
    const sessionId = 'web:s_test';
    const streamId = `__streaming_${sessionId}`;
    const merged = [streamingMessage(sessionId, 'hello')];
    const slot = makeSlot({
      realtimeMessages: [streamingMessage(sessionId, 'hello')],
      merged,
      _lastRealtimeRef: [streamingMessage(sessionId, 'hello')],
    });

    const mergedBefore = slot.merged;
    const patched = patchMergedStreamingMessage(slot, streamId, 'hello world', PROVIDER);

    expect(patched).toBe(true);
    expect(slot.merged).toBe(mergedBefore);
    expect(slot.merged[0]?.content).toBe('hello world');
  });

  it('returns false when the streaming row is not yet in merged', () => {
    const slot = makeSlot();
    expect(patchMergedStreamingMessage(slot, '__streaming_missing', 'text', PROVIDER)).toBe(false);
  });

  it('skips object replacement when content is unchanged', () => {
    const sessionId = 'web:s_test';
    const streamId = `__streaming_${sessionId}`;
    const row = streamingMessage(sessionId, 'same');
    const slot = makeSlot({ merged: [row] });
    const rowBefore = slot.merged[0];

    patchMergedStreamingMessage(slot, streamId, 'same', PROVIDER);

    expect(slot.merged[0]).toBe(rowBefore);
  });
});

describe('createRafNotifyScheduler', () => {
  it('coalesces multiple schedules for the same session into one frame callback', () => {
    const frames: Array<() => void> = [];
    const activeSessionId: string | null = 'web:s_1';
    let notifyCount = 0;

    const scheduler = createRafNotifyScheduler(
      (sessionId) => sessionId === activeSessionId,
      () => {
        notifyCount += 1;
      },
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
      () => {},
    );

    scheduler.schedule('web:s_1');
    scheduler.schedule('web:s_1');
    scheduler.schedule('web:s_1');

    expect(frames).toHaveLength(1);

    frames[0]?.();
    expect(notifyCount).toBe(1);

    scheduler.schedule('web:s_1');
    expect(frames).toHaveLength(2);
  });

  it('does not schedule when the session is not active', () => {
    const frames: Array<() => void> = [];
    const onNotify = vi.fn();

    const scheduler = createRafNotifyScheduler(
      () => false,
      onNotify,
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
      () => {},
    );

    scheduler.schedule('web:s_1');
    expect(frames).toHaveLength(0);
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('cancelAll clears pending frame callbacks', () => {
    const frames: Array<() => void> = [];
    const cancelled: number[] = [];
    const onNotify = vi.fn();

    const scheduler = createRafNotifyScheduler(
      () => true,
      onNotify,
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
      (handle) => {
        cancelled.push(handle);
      },
    );

    scheduler.schedule('web:s_1');
    scheduler.cancelAll();

    expect(cancelled).toEqual([1]);
    frames[0]?.();
    expect(onNotify).not.toHaveBeenCalled();
  });
});

describe('useSessionStore streaming updates', () => {
  it('replaces merged message references as text deltas grow', () => {
    const sessionId = 'web:s_stream';
    const { result, unmount } = renderHook(() => useSessionStore());

    act(() => {
      result.current.setActiveSession(sessionId);
      result.current.updateStreaming(sessionId, 'hello', PROVIDER);
    });

    const firstMessages = result.current.getMessages(sessionId);
    expect(firstMessages[0]?.content).toBe('hello');

    act(() => {
      result.current.updateStreaming(sessionId, 'hello world', PROVIDER);
    });

    const secondMessages = result.current.getMessages(sessionId);
    expect(secondMessages).not.toBe(firstMessages);
    expect(secondMessages[0]).not.toBe(firstMessages[0]);
    expect(secondMessages[0]?.content).toBe('hello world');

    unmount();
  });
});
