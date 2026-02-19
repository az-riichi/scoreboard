import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          event.cookies.set(name, value, { ...options, path: '/' });
        });
      }
    }
  });

  const { data: sessionData } = await event.locals.supabase.auth.getSession();
  const session = sessionData.session ?? null;

  if (!session) {
    event.locals.session = null;
    event.locals.userId = null;
  } else {
    const { data: claimsData, error } = await event.locals.supabase.auth.getClaims();
    if (error || !claimsData?.claims) {
      event.locals.session = null;
      event.locals.userId = null;
    } else {
      event.locals.session = session;
      event.locals.userId = (claimsData.claims as any).sub ?? null;
    }
  }

  return resolve(event, {
    filterSerializedResponseHeaders(name) {
      return name === 'content-range';
    }
  });
};
