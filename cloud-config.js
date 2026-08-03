/*
 * Cloud project connection for this tracker.
 * Run supabase-setup.sql once in the matching Supabase project's SQL Editor,
 * then add the GitHub Pages URL to Authentication > URL Configuration.
 *
 * The public/anon key is designed to be used in browser code. Never paste a
 * service_role key here. Row Level Security in supabase-setup.sql protects
 * each signed-in user's tracker.
 */
window.CLOUD_CONFIG = {
  supabaseUrl: "https://lfdetzrwmtvahezwiniz.supabase.co",
  supabaseAnonKey: "sb_publishable_Okb2ThiWJVsgVERYraRSNw_LTyOZFUI",
};
