// LOCAL RUNNER ONLY (ADR-045): reads the recording sink so a developer, the boot smoke or an E2E test can complete a
// sign-in without any SMS provider. Codes are random per challenge (no master or deterministic code); the route exists
// only in this non-deployable runner, and the CI artifact-isolation check proves it is absent from release artefacts.
import { Controller, Get, Query, type Type } from '@nestjs/common';
import { normalisePakistanMobile } from '@wayvro/domain';
import { WayvroError } from '@wayvro/observability';
import type { RecordingOtpDelivery } from '@wayvro/provider-test-doubles';
import { Public } from '../src/auth/policy.js';

export function localOtpInbox(sink: RecordingOtpDelivery): Type {
  @Controller()
  class LocalOtpInboxController {
    @Get('/__local/otp-inbox')
    @Public()
    inbox(@Query('phone') phone: unknown): { messages: Array<{ message: string; recordedAt: string }> } {
      const n = typeof phone === 'string' ? normalisePakistanMobile(phone) : null;
      if (!n?.ok) throw new WayvroError('WAYVRO_E_VALIDATION');
      return { messages: sink.messagesFor(n.e164).map((m) => ({ message: m.message, recordedAt: m.recordedAt.toISOString() })) };
    }
  }
  return LocalOtpInboxController;
}
