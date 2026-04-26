import { createClient } from '@supabase/supabase-js';

const url  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Supabase client — only created when env vars are present.
 * Electron 桌面端构建时不需要 Supabase，此值为 null，auth 模块会自动跳过。
 */
export const supabase = url && key ? createClient(url, key) : null;

export type SupabaseUser = Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getUser']>>['data']['user'];
