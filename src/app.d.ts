/// <reference types="@sveltejs/kit" />

import type { SupabaseClient, Session } from '@supabase/supabase-js';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      session: Session | null;
      userId: string | null;
    }

    interface PageData {
      session: Session | null;
      isAdmin: boolean;
      activeSeasonId: string | null;
    }
  }
}

export {};
