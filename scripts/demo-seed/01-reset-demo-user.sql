-- Reset demo user: rename + set known password.
-- Password: DemoSunday2026!  (argon2id hash generated below by separate script)
-- Run AFTER computing the hash via 02-hash-password.mjs and updating below.

\set ON_ERROR_STOP on

UPDATE public.firm_users
SET full_name      = 'Δημήτριος Παπαδόπουλος',
    bar_id         = 'ΔΣΑ-024183',
    password_hash  = :'pwhash',
    is_active      = true
WHERE email = 'demo@themisos.gr';

SELECT id, email, full_name, bar_id, is_active FROM public.firm_users WHERE email = 'demo@themisos.gr';
