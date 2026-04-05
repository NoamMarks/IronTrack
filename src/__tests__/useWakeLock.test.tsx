import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWakeLock } from '../hooks/useWakeLock';

describe('useWakeLock', () => {
  const mockRelease = vi.fn().mockResolvedValue(undefined);
  const mockSentinel = {
    release: mockRelease,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRelease.mockClear();
    mockSentinel.addEventListener.mockClear();
  });

  it('reports isSupported based on navigator.wakeLock', () => {
    // jsdom doesn't have wakeLock, so isSupported should be false
    const { result } = renderHook(() => useWakeLock());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.isActive).toBe(false);
  });

  it('activates wake lock on toggle when supported', async () => {
    const mockRequest = vi.fn().mockResolvedValue(mockSentinel);
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      configurable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.toggle();
    });

    expect(mockRequest).toHaveBeenCalledWith('screen');
    expect(result.current.isActive).toBe(true);

    // Cleanup
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      configurable: true,
    });
  });

  it('deactivates wake lock on second toggle', async () => {
    const mockRequest = vi.fn().mockResolvedValue(mockSentinel);
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      configurable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    // First toggle: activate
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.isActive).toBe(true);

    // Second toggle: deactivate
    await act(async () => {
      await result.current.toggle();
    });
    expect(mockRelease).toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);

    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      configurable: true,
    });
  });
});
