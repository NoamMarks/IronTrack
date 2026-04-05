import { describe, it, expect } from 'vitest';
import { parseTimerCommand } from '../lib/voiceCommands';

describe('parseTimerCommand', () => {
  it('parses "timer three minutes"', () => {
    expect(parseTimerCommand('timer three minutes')).toEqual({ seconds: 180 });
  });

  it('parses "rest ninety seconds"', () => {
    expect(parseTimerCommand('rest ninety seconds')).toEqual({ seconds: 90 });
  });

  it('parses "rest 2 minutes 30 seconds"', () => {
    expect(parseTimerCommand('rest 2 minutes 30 seconds')).toEqual({ seconds: 150 });
  });

  it('parses "timer 90 seconds"', () => {
    expect(parseTimerCommand('timer 90 seconds')).toEqual({ seconds: 90 });
  });

  it('parses "3 minutes" without trigger word', () => {
    expect(parseTimerCommand('3 minutes')).toEqual({ seconds: 180 });
  });

  it('parses "sixty seconds"', () => {
    expect(parseTimerCommand('sixty seconds')).toEqual({ seconds: 60 });
  });

  it('parses compound with "and": "2 minutes and 15 seconds"', () => {
    expect(parseTimerCommand('2 minutes and 15 seconds')).toEqual({ seconds: 135 });
  });

  it('is case insensitive', () => {
    expect(parseTimerCommand('Timer Three Minutes')).toEqual({ seconds: 180 });
  });

  it('returns null for empty input', () => {
    expect(parseTimerCommand('')).toBeNull();
  });

  it('returns null for unrecognized command', () => {
    expect(parseTimerCommand('hello world')).toBeNull();
  });

  it('returns null for "timer" alone', () => {
    expect(parseTimerCommand('timer')).toBeNull();
  });

  it('parses "start 5 minutes"', () => {
    expect(parseTimerCommand('start 5 minutes')).toEqual({ seconds: 300 });
  });
});
