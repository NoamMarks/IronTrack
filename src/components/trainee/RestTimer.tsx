import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, X, Plus, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseTimerCommand } from '../../lib/voiceCommands';
import { hapticAlarm } from '../../lib/haptics';
import { cn } from '../../lib/utils';

// ─── SpeechRecognition type bridge ──────────────────────────────────────────

interface SpeechRecognitionResult {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: { readonly [index: number]: SpeechRecognitionResult };
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionInstance)
    | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RestTimer() {
  const [remaining, setRemaining] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasSpeech = typeof window !== 'undefined' && !!getSpeechRecognition();

  // ── Timer tick ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (isRunning && remaining > 0) {
      intervalRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            hapticAlarm();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning, remaining]);

  // ── Start timer ─────────────────────────────────────────────────────────

  const startTimer = useCallback((secs: number) => {
    setRemaining(secs);
    setIsRunning(true);
    setIsExpanded(true);
    setTranscript('');
    setVoiceError('');
  }, []);

  // ── Voice recognition ──────────────────────────────────────────────────

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SR = getSpeechRecognition();
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? '';
      setTranscript(text);
      const parsed = parseTimerCommand(text);
      if (parsed) {
        setVoiceError('');
        startTimer(parsed.seconds);
      } else if (text.trim()) {
        setVoiceError('Try "rest 90 seconds" or "timer 3 minutes"');
      }
      setIsListening(false);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, startTimer]);

  // ── Cleanup ────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  // ── ESC closes the floating panel ──────────────────────────────────────
  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  // ── Format ─────────────────────────────────────────────────────────────

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const display = `${mins}:${String(secs).padStart(2, '0')}`;

  // ── Presets ────────────────────────────────────────────────────────────

  const presets = [60, 90, 120, 180];

  return (
    <>
      {/* Floating button */}
      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-colors',
          isRunning
            ? 'bg-green-600 text-white animate-pulse'
            : 'bg-foreground text-background hover:opacity-90'
        )}
        whileTap={{ scale: 0.9 }}
        data-testid="rest-timer-fab"
      >
        {isRunning ? (
          <span className="text-xs font-bold font-mono">{display}</span>
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </motion.button>

      {/* Expanded panel */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.9 }}
            className="fixed bottom-24 right-6 z-50 w-72 bg-card border border-border shadow-2xl rounded-sm p-6 space-y-5"
            data-testid="rest-timer-panel"
          >
            {/* Close */}
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                Rest Timer
              </h3>
              <button onClick={() => setIsExpanded(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Countdown display */}
            <div className="text-center">
              <p className="text-5xl font-bold font-mono tracking-tighter" data-testid="timer-display">
                {display}
              </p>
            </div>

            {/* +/- 15s controls */}
            <div className="flex justify-center gap-4">
              <button
                onClick={() => setRemaining((r) => Math.max(0, r - 15))}
                className="w-10 h-10 border border-border rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (isRunning) { setIsRunning(false); setRemaining(0); }
                  else if (remaining > 0) setIsRunning(true);
                }}
                className={cn(
                  'px-6 py-2 text-xs font-bold uppercase tracking-widest transition-all',
                  isRunning
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-foreground text-background hover:opacity-90'
                )}
                data-testid="timer-start-stop"
              >
                {isRunning ? 'Stop' : 'Start'}
              </button>
              <button
                onClick={() => setRemaining((r) => r + 15)}
                className="w-10 h-10 border border-border rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Presets */}
            <div className="grid grid-cols-4 gap-2">
              {presets.map((s) => (
                <button
                  key={s}
                  onClick={() => startTimer(s)}
                  data-testid={`preset-${s}`}
                  className="py-2 text-[10px] font-mono uppercase border border-border hover:bg-foreground hover:text-background transition-all"
                >
                  {s >= 60 ? `${s / 60}m` : `${s}s`}
                </button>
              ))}
            </div>

            {/* Voice button */}
            {hasSpeech && (
              <button
                onClick={toggleVoice}
                data-testid="voice-btn"
                className={cn(
                  'w-full py-3 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 border transition-all',
                  isListening
                    ? 'bg-red-600 text-white border-red-600 animate-pulse'
                    : 'border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground'
                )}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {isListening ? 'Listening...' : 'Voice Command'}
              </button>
            )}

            {/* Transcript feedback */}
            {transcript && (
              <p className="text-[10px] font-mono text-muted-foreground text-center truncate">
                "{transcript}"
              </p>
            )}
            {voiceError && (
              <p
                className="text-[10px] font-mono text-amber-500 text-center"
                data-testid="voice-error"
              >
                {voiceError}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
