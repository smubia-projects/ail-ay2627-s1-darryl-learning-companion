import { useEffect, useState } from 'react';
import { DEMO_PAUSED_EVENT, RATE_LIMIT_EVENT } from '@/lib/api';
import { DemoPausedNotice, RateLimitCTA } from '@/components/RateLimitCTA';

/** Renders the CTA modal on 429 and the paused notice on 503, from apiRequest's window events. */
export function RateLimitGate() {
  const [limited, setLimited] = useState<number | null>(null);
  const [paused, setPaused] = useState<string | null>(null);
  useEffect(() => {
    const onLimit = (event: Event) => setLimited((event as CustomEvent<{ queriesUsed: number }>).detail.queriesUsed);
    const onPause = (event: Event) => setPaused((event as CustomEvent<{ message: string }>).detail.message);
    window.addEventListener(RATE_LIMIT_EVENT, onLimit);
    window.addEventListener(DEMO_PAUSED_EVENT, onPause);
    return () => {
      window.removeEventListener(RATE_LIMIT_EVENT, onLimit);
      window.removeEventListener(DEMO_PAUSED_EVENT, onPause);
    };
  }, []);
  if (paused !== null) return <DemoPausedNotice message={paused} onDismiss={() => setPaused(null)} />;
  if (limited !== null) return <RateLimitCTA queriesMade={limited} onDismiss={() => setLimited(null)} />;
  return null;
}
