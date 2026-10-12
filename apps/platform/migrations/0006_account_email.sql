-- An account's email and display name. `email` is always one whose owner
-- proved it: sign-up writes the account only after the code mailed to it
-- came back, and Google's address only when Google says it verified it.
-- `email_key` is the address lowercased, so two spellings are one address
-- and a racing second sign-up fails on the index. Accounts made before this
-- migration have neither until their person adds an email at sign-in; a
-- unique index lets any number of rows hold NULL.
ALTER TABLE accounts ADD COLUMN email TEXT;
ALTER TABLE accounts ADD COLUMN email_key TEXT;
ALTER TABLE accounts ADD COLUMN display_name TEXT;
CREATE UNIQUE INDEX accounts_by_email ON accounts (email_key);
