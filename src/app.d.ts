/// <reference types="@sveltejs/kit" />

import type { SupabaseClient, User } from '@supabase/supabase-js';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      user: User | null;
      userId: string | null;
    }

    interface PageData {
      user: User | null;
      isAdmin: boolean;
      activeSeasonId: string | null;
    }
  }
}

export {};
