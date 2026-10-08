-- Outside identities linked to platform accounts: the provider
-- (`google`), its stable subject id for the person (Google's `sub`), and the
-- account's `handle_key` (the handle lowercased, as in `accounts`). Nothing
-- else: no email, no name, no token. One outside account names one handle,
-- so a second link of a subject to another handle fails on the key.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  handle_key TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
