-- Where a chat was started: 'mainui' for one opened from CO2SorptionDT's
-- Daedalus tab, NULL for the web app (and every chat before this). The sidebar
-- marks the MainUI ones; each turn's own origin is in the audit log.
ALTER TABLE chat_sessions ADD COLUMN origin TEXT;
