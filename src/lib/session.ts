import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type SessionState = { signedIn: boolean; isAdmin: boolean };

const ADMIN_LINK_KEY = 'azrm-show-admin-link';

/** Supabase keeps its session in cookies scripts can read, so a visitor without one is signed out. */
export function hasAuthCookie(): boolean {
  if (!browser) return false;
  return document.cookie.split(';').some((cookie) => {
    const name = cookie.split('=')[0].trim();
    return name.startsWith('sb-') && name.includes('-auth-token');
  });
}

function rememberedAdminLink(): boolean {
  try {
    return localStorage.getItem(ADMIN_LINK_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberAdminLink(show: boolean) {
  try {
    if (show) localStorage.setItem(ADMIN_LINK_KEY, '1');
    else localStorage.removeItem(ADMIN_LINK_KEY);
  } catch {}
}

function initialSession(): SessionState {
  const signedIn = hasAuthCookie();
  return { signedIn, isAdmin: signedIn && rememberedAdminLink() };
}

/**
 * What the header shows. It starts from the visitor's cookie and last confirmed
 * state so that the page need not wait on the server. This only decides which
 * links appear: every admin page and action checks access on the server.
 */
export const session = writable<SessionState>(initialSession());

export async function confirmSession(): Promise<void> {
  if (!hasAuthCookie()) {
    rememberAdminLink(false);
    return;
  }

  try {
    const response = await fetch('/api/session', { credentials: 'same-origin' });
    if (!response.ok) return;
    const { signedIn, isAdmin }: SessionState = await response.json();
    session.set({ signedIn, isAdmin });
    rememberAdminLink(isAdmin);
  } catch {
    // Keep what the header shows. Admin pages still check access themselves.
  }
}
