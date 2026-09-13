/* The anon key is meant to be public — it only lets the browser talk to the
   API. Row-level security is what protects the data. Never put the service
   role key in here. */
window.RMM_CONFIG = {
  supabaseUrl: "https://zijncucnubcpxtwvkaqv.supabase.co",
  supabaseKey: "sb_publishable_w_VyTpnBTSmAl0n3-IPysg_JAzjaaaV",
  // Optional endpoint that drafts the report commentary server-side.
  ai: ""
};
