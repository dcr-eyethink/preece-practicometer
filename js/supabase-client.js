(function () {
  const cfg = window.PRACTICOMETER_CONFIG;
  const configured = cfg && cfg.supabaseUrl && !cfg.supabaseUrl.includes('YOUR-PROJECT-REF');
  if (!configured) {
    console.error(
      'Preece Practicometer: js/config.js is missing or still has placeholder values. ' +
      'Copy js/config.example.js to js/config.js and fill in your Supabase project URL and anon key.'
    );
    window.sbClient = null;
    return;
  }
  window.sbClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
})();
