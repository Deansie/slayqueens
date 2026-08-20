'use strict';
// These values are PUBLIC BY DESIGN and safe to commit to a public repo.
//
// The anon/publishable key is meant to live in the browser. On its own it grants
// nothing — every table has Row Level Security (see sql/schema.sql) and the app
// requires login, so anonymous requests get denied. What protects the data is
// RLS + auth, not hiding this key. (Same idea as the budget app committing its
// MSAL clientId.) You cannot hide a key the browser uses anyway; a private repo
// would not help, since the key is served to every visitor's device.
//
// NEVER put the secret service_role key or the VAPID PRIVATE key here — those
// live only as Supabase Edge Function secrets on the server.
const CONFIG = {
  SUPABASE_URL:      'https://asryokpahnoklydsgiyl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzcnlva3BhaG5va2x5ZHNnaXlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMDc5MjQsImV4cCI6MjA5ODU4MzkyNH0.mvzAm2ZW4Cf7ee-x_ZiN5gq2LJPWatvtLCpuPHwz-GQ',
  VAPID_PUBLIC_KEY:  'BHZEVi1GdRiJxh1qbhLZCx2TopWTYmzzZDUOT7OyWQ_eRP9yb0W9fQlxGXkPx4zmfkRfT2ppghLeBesvHGx0qQY',  // public — safe to commit

  // Weather widget in the header. Uses the free, keyless Open-Meteo API (open-meteo.com).
  // These are just the FIRST-RUN default — each device can pick its own location in the app
  // (tap the weather, or the profile menu → "Väderplats"); that choice is saved per device
  // and overrides this. Set WEATHER_ENABLED false for no default (users can still opt in).
  WEATHER_ENABLED: true,
  WEATHER_LAT:     56.833,   // Ljungby
  WEATHER_LON:     13.941,
  WEATHER_LABEL:   'Ljungby'
};
