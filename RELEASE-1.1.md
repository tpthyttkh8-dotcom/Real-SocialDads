# Real SocialDads – Release 1.1

**What's in it:** a fix for people whose sign-in links "don't work", especially on university or work email (Microsoft 365, like tcd.ie).

Those email systems open every link in an incoming email to check it's safe. Sign-in links only work once, so the check used the link up before the person could tap it (the same thing used up the code too). Now the link in the email opens the site with a **Finish signing in** button, and sign-in only happens when the person taps it. Email checkers open pages but don't press buttons. The 6-digit code still works as a back-up. Nothing else changes.

**How to install (in this order)**
1. Upload `app.js`, `index.html` and `README.md` to your GitHub repository (and `styles.css`, which hasn't changed but is fine to upload). Keep your own `config.js`.
2. Wait a minute for GitHub to publish it.
3. In Supabase → **Authentication → Emails → Templates**, open **Magic link**, replace the body with the template below and save. Then do the same for **Confirm sign up**.
4. Check Supabase → **Authentication → URL Configuration → Site URL** is exactly `https://tpthyttkh8-dotcom.github.io/Real-SocialDads/` (with the `/` at the end).
5. Ask the person to request a new sign-in email, wait for it (one request only), tap the link, then tap **Finish signing in**.

Do step 1 before step 3: the old app doesn't know about the new link.

**Email template** (same for Magic link and Confirm sign up; subject e.g. `Your Real SocialDads sign-in`):
```html
<h2>Sign in to Real SocialDads</h2>
<p><a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email">Tap here to sign in</a></p>
<p>Or type this code into the app: <b>{{ .Token }}</b></p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

**Database: clear Supabase's security warnings (any time)**
Supabase's Security Advisor flags `motm_results` and `player_stats` as "Security Definer View". Nothing was exposed (both only ever returned rows to approved members), but to clear the warnings run `supabase/migration_view_security.sql` once in the SQL Editor. It makes both views follow each person's own access rules; man of the match votes stay anonymous. Safe to run twice; the app doesn't change.

**Database: tighten function permissions (any time)**
Run `supabase/migration_function_permissions.sql` once in the SQL Editor. Signed-out visitors can no longer run any of the database functions, and the automatic ones (new sign-ups, new players, filing draw rules) can't be called directly. It clears Supabase's "Public Can Execute SECURITY DEFINER Function" warnings. About 18 "Signed-In Users Can Execute" warnings remain on purpose: they're the app's own actions (save score, vote, invite and so on), each of which checks who's asking. "Leaked Password Protection" doesn't apply: nobody has a password.

**If something goes wrong:** the "Check your email" screen's code box still works. To undo, put `{{ .ConfirmationURL }}` back in place of `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email` in the templates. Old-style links still work with this release.
