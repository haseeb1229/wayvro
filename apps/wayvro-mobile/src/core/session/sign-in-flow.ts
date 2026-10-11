import type { OtpChallenge } from '@wayvro/contracts';

/**
 * In-memory state of the sign-in flow between the phone and code screens. The challenge is never persisted: after a
 * restart the user requests a new code (which supersedes the old one on the server). `notice` carries the one-off
 * banner shown on the phone screen after a sign-out that the server could not confirm.
 */
export type SignInNotice = 'signed-out-local-only' | null;

export class SignInFlow {
  private challenge: OtpChallenge | null = null;
  private notice: SignInNotice = null;
  private readonly listeners = new Set<() => void>();

  getChallenge = (): OtpChallenge | null => this.challenge;
  getNotice = (): SignInNotice => this.notice;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setChallenge(challenge: OtpChallenge | null): void {
    this.challenge = challenge;
    this.emit();
  }

  setNotice(notice: SignInNotice): void {
    this.notice = notice;
    this.emit();
  }

  reset(): void {
    this.challenge = null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
