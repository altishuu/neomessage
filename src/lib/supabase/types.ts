/**
 * Supabase Database type definitions.
 *
 * Auto-generate this file from your linked Supabase project:
 *
 *   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
 *
 * Or from a specific project:
 *
 *   npx supabase gen types typescript --project-id <PROJECT_ID> > src/lib/supabase/types.ts
 *
 * The Database interface below serves as a **placeholder** so the client
 * helpers (server.ts, client.ts, middleware.ts) compile without errors.
 * Replace this entire file with the generated output once your Supabase
 * project is configured.
 *
 * --- Manual stub (safe to use during development) ---
 *
 * All tables are typed as `Record<string, any>` here so column access works
 * at runtime. The generated types will add proper row-level type safety.
 */

/**
 * Placeholder Database type that accepts any table name.
 * Replace this with the generated types from `supabase gen types`.
 *
 * Generated shape:
 *   type Database = {
 *     public: {
 *       Tables: {
 *         user_profiles: { Row: UserProfile; Insert: UserProfileInsert; Update: UserProfileUpdate };
 *         conversations: { Row: Conversation; ... };
 *         conversation_participants: { Row: ... };
 *         messages: { Row: ... };
 *       };
 *     };
 *   };
 */
export type Database = {
  public: {
    Tables: {
      [tableName: string]: {
        Row: Record<string, any>;
        Insert: Record<string, any>;
        Update: Record<string, any>;
      };
    };
  };
};
