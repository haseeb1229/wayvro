import { useEffect, useState } from 'react';
import { useServices } from '../services/ServicesProvider';

/**
 * Server-adjusted "now" for UX countdowns (device clock + the offset learnt from the server's `Date` header), refreshed
 * every `tickMs`. Display only: the server enforces every deadline itself.
 */
export function useServerNow(tickMs: number): number {
  const { clock } = useServices();
  const [now, setNow] = useState(() => Date.now() + clock.offsetMs);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now() + clock.offsetMs);
    }, tickMs);
    return () => {
      clearInterval(timer);
    };
  }, [clock, tickMs]);
  return now;
}
