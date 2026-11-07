import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle, RequestEvent } from '@sveltejs/kit';

// A new deploy clears this copy, so it can last as long as a static asset would.
const APP_SHELL_CDN_CACHE = 'public, durable, s-maxage=31536000';

// Every page sets ssr = false, so its document is the same app shell for every
// visitor: it holds no data and runs no server load. Those arrive afterwards
// through __data.json, which is not covered by this. Endpoints that answer GET
// live under /api and are not covered either.
function isAppShellRequest({ request, isDataRequest, route }: RequestEvent) {
  return (
    request.method === 'GET' &&
    !isDataRequest &&
    route.id !== null &&
    !route.id.startsWith('/api/')
  );
}

export const handle: Handle = async ({ event, resolve }) => {
  const authResponseHeaders = new Headers();
  const isAppShell = isAppShellRequest(event);
  // The shared scoreboard snapshot is always read with anonymous RLS, even
  // for signed-in visitors. Polling it does not need an Auth round trip. The app
  // shell must not touch the session at all: a refreshed cookie on a cached
  // response would hand one visitor's session to the next.
  const isAnonymousRequest = isAppShell || event.route.id === '/api/public-data';

  event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => isAnonymousRequest ? [] : event.cookies.getAll(),
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

  const hasSupabaseAuthCookie = !isAnonymousRequest && event.cookies
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

  if (
    isAppShell &&
    response.status === 200 &&
    response.headers.get('content-type')?.startsWith('text/html') &&
    !response.headers.has('set-cookie')
  ) {
    response.headers.set('netlify-cdn-cache-control', APP_SHELL_CDN_CACHE);
  }

  return response;
};
