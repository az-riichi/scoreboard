import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const authResponseHeaders = new Headers();

  event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookiesToSet, headersToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          event.cookies.set(name, value, { ...options, path: options.path ?? '/' });
        });
        for (const [name, value] of Object.entries(headersToSet)) {
          authResponseHeaders.set(name, value);
        }
      }
    }
  });

  const hasSupabaseAuthCookie = event.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'));

  if (!hasSupabaseAuthCookie) {
    event.locals.user = null;
    event.locals.userId = null;
  } else {
    const { data: userData, error: userError } = await event.locals.supabase.auth.getUser();
    const user = userData.user ?? null;

    if (userError || !user) {
      event.locals.user = null;
      event.locals.userId = null;
    } else {
      event.locals.user = user;
      event.locals.userId = user.id;
    }
  }

  const response = await resolve(event, {
    filterSerializedResponseHeaders(name) {
      return name === 'content-range';
    }
  });

  authResponseHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
};
