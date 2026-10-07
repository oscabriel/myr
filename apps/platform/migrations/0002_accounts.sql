-- Platform accounts (W3 316): a handle and a password hash, nothing else.
-- `handle_key` is the handle lowercased, the rule protocol's `sameHandle`
-- compares by, so two handles that differ only in case are one account and
-- a racing second sign-up fails on the key. `password_hash` is
-- `pbkdf2-sha256$<iterations>$<salt>$<hash>`; no password is ever stored.
CREATE TABLE accounts (
  handle_key TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
