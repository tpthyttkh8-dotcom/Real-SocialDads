# Real SocialDads – Release 1.2

**What's in it:** a how-to for adding Real SocialDads to your home screen, matched to the phone you're on.

- The site works out whether it's on an **iPhone/iPad** or an **Android** phone (and which browser), and whether it's **already open from the home screen**.
- **Matches page:** a card with the right steps for that phone. Android phones using Chrome usually get a one-tap **Install app** button instead of steps. It doesn't show on computers or once the site is on the home screen. **Not now** hides it for 30 days.
- **Your profile → Add to your home screen:** the steps any time, with iPhone and Android tabs (handy for helping a friend). On a computer it shows the site link to open on your phone.
- **Sign-in screen on an iPhone:** a tip to add it to the Home Screen first and sign in from the icon, so people only sign in once.
- If someone opens the link inside another app (like Instagram), it tells them to open it in Safari or Chrome first.

**How to install**
1. Upload `app.js`, `styles.css`, `index.html` and `README.md` to your GitHub repository. Keep your own `config.js`.
2. Refresh the site. **No database change.**

Builds on Release 1.1. If you skipped 1.1, do its steps too (see RELEASE-1.1.md): the two email templates, then run `supabase/migration_view_security.sql` and `supabase/migration_function_permissions.sql` in the Supabase SQL editor.
