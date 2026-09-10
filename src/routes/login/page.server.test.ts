import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';

function formRequest(fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return new Request('https://scoreboard.example/login', { method: 'POST', body: form });
}

function passwordResetAction() {
  const action = actions.requestPasswordReset;
  if (!action) throw new Error('requestPasswordReset action is missing');
  return action;
}

describe('requestPasswordReset', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a recovery link back to the reset-password route', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null });
    const locals = { supabase: { auth: { resetPasswordForEmail } } } as unknown as App.Locals;

    const result = await passwordResetAction()({
      request: formRequest({ 'reset-email': '  player@example.com  ' }),
      locals,
      url: new URL('https://scoreboard.example/login')
    } as never);

    expect(resetPasswordForEmail).toHaveBeenCalledWith('player@example.com', {
      redirectTo: 'https://scoreboard.example/reset-password'
    });
    expect(result).toMatchObject({
      ok: true,
      message:
        'If an account exists for that email, a password reset link has been sent. Open the newest link in this browser.'
    });
  });

  it('does not call Supabase without an email address', async () => {
    const resetPasswordForEmail = vi.fn();
    const locals = { supabase: { auth: { resetPasswordForEmail } } } as unknown as App.Locals;

    const result = await passwordResetAction()({
      request: formRequest({ 'reset-email': '   ' }),
      locals,
      url: new URL('https://scoreboard.example/login')
    } as never);

    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400, data: { ok: false } });
  });

  it('does not expose provider error details', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'user lookup detail' }
    });
    const locals = { supabase: { auth: { resetPasswordForEmail } } } as unknown as App.Locals;

    const result = await passwordResetAction()({
      request: formRequest({ 'reset-email': 'player@example.com' }),
      locals,
      url: new URL('https://scoreboard.example/login')
    } as never);

    expect(result).toMatchObject({
      status: 400,
      data: {
        ok: false,
        message: 'Could not send a reset email. Please wait a moment and try again.'
      }
    });
  });

  it.each(['over_email_send_rate_limit', 'over_request_rate_limit', undefined])(
    'preserves a Supabase 429 (%s) without leaking provider details or retrying',
    async (code) => {
      const resetPasswordForEmail = vi.fn().mockResolvedValue({
        data: null,
        error: {
          status: 429,
          code,
          message: 'Provider details for player@example.com'
        }
      });
      const locals = { supabase: { auth: { resetPasswordForEmail } } } as unknown as App.Locals;

      const result = await passwordResetAction()({
        request: formRequest({ 'reset-email': 'player@example.com' }),
        locals,
        url: new URL('https://scoreboard.example/login')
      } as never);

      expect(result).toMatchObject({
        status: 429,
        data: {
          ok: false,
          message:
            'Too many password reset requests or emails have been sent. Please wait before trying again. If this keeps happening, contact a club admin.'
        }
      });
      expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith('Password reset request failed.', {
        status: 429,
        code: code ?? 'unknown'
      });
    }
  );
});
