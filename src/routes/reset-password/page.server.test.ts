import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

function formRequest(fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return new Request('https://scoreboard.example/reset-password', {
    method: 'POST',
    body: form
  });
}

function updatePasswordAction() {
  const action = actions.updatePassword;
  if (!action) throw new Error('updatePassword action is missing');
  return action;
}

describe('reset-password page', () => {
  it('exchanges a recovery code and redirects to a clean URL', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ data: {}, error: null });
    const locals = {
      user: null,
      supabase: { auth: { exchangeCodeForSession } }
    } as unknown as App.Locals;

    await expect(
      load({
        locals,
        url: new URL('https://scoreboard.example/reset-password?code=recovery-code')
      } as never)
    ).rejects.toMatchObject({ status: 303, location: '/reset-password' });
    expect(exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
  });

  it('rejects an invalid or expired recovery code', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'expired' }
    });
    const locals = {
      user: null,
      supabase: { auth: { exchangeCodeForSession } }
    } as unknown as App.Locals;

    const result = await load({
      locals,
      url: new URL('https://scoreboard.example/reset-password?code=expired-code')
    } as never);

    expect(result).toMatchObject({ canReset: false });
  });

  it('validates confirmation before updating the password', async () => {
    const updateUser = vi.fn();
    const locals = {
      user: { id: 'user-id' },
      supabase: { auth: { updateUser } }
    } as unknown as App.Locals;

    const result = await updatePasswordAction()({
      request: formRequest({ password: 'new password', 'password-confirmation': 'different' }),
      locals
    } as never);

    expect(updateUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 400,
      data: { ok: false, message: 'The passwords do not match.' }
    });
  });

  it('updates the password, clears the recovery session, and returns to sign in', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const locals = {
      user: { id: 'user-id' },
      supabase: { auth: { updateUser, signOut } }
    } as unknown as App.Locals;

    await expect(
      updatePasswordAction()({
        request: formRequest({
          password: 'new secure password',
          'password-confirmation': 'new secure password'
        }),
        locals
      } as never)
    ).rejects.toMatchObject({ status: 303, location: '/login?passwordReset=1' });

    expect(updateUser).toHaveBeenCalledWith({ password: 'new secure password' });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
