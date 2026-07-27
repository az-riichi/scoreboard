export const NEW_CASUAL_EVENT_VALUE = '__new__';

type EventResolution =
  | { ok: true; eventId: string | null }
  | { ok: false; message: string };

function normalizeEventName(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export async function resolveCasualEvent(
  locals: App.Locals,
  selectedValue: unknown,
  newNameValue: unknown
): Promise<EventResolution> {
  const selected = String(selectedValue ?? '').trim();

  if (!selected) return { ok: true, eventId: null };

  if (selected === NEW_CASUAL_EVENT_VALUE) {
    const name = normalizeEventName(newNameValue);
    if (!name) return { ok: false, message: 'Enter a name for the new event.' };
    if (name.length > 100) return { ok: false, message: 'Event names can be at most 100 characters.' };

    const createRes = await locals.supabase.rpc('get_or_create_casual_event_authorized', {
      p_name: name
    });
    const eventId = String(createRes.data ?? '').trim();
    if (createRes.error || !eventId) {
      return { ok: false, message: createRes.error?.message ?? 'Could not create the event.' };
    }
    return { ok: true, eventId };
  }

  const eventRes = await locals.supabase
    .from('casual_events')
    .select('id')
    .eq('id', selected)
    .maybeSingle();
  if (eventRes.error || !eventRes.data) {
    return { ok: false, message: 'The selected casual event was not found.' };
  }

  return { ok: true, eventId: eventRes.data.id };
}
