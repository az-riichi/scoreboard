/// <reference types="@sveltejs/kit" />

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AdminAccess } from '$lib/permissions';

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
      adminAccess: AdminAccess;
      activeSeasonId: string | null;
    }
  }
}

export {};
