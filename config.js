// config.js — backend settings.
//
// Leave both values empty to run in LOCAL DEMO mode: everything is stored in this
// browser only (localStorage) and the admin control room is NOT private.
//
// To share live results with every visitor and lock down the admin, create a free
// Supabase project, run supabase-schema.sql in its SQL editor, then paste your
// Project URL and the *anon public* key here. The anon key is designed to be public;
// security comes from Row Level Security in the database, not from hiding this file.
// NEVER put the service_role key in this file.

export default {
  supabaseUrl: '',
  supabaseAnonKey: '',
  stateRowId: 'main',
};
