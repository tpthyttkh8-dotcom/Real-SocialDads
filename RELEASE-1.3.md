# Real SocialDads – Release 1.3

**What's in it:** admins can see who has Real SocialDads on their home screen.

- **Admin → Members** shows how many are set up (for example "9 of 14 on home screen"). Under each name you see their phone (iPhone, iPad or Android) and when they last opened the app from the icon, or "Not opened from the home screen yet".
- The line fades after 30 days without an open from the icon, in case they've deleted it.
- **Copy a reminder** makes a ready-made WhatsApp message naming the people who haven't done it yet.
- It's recorded automatically when someone opens the app from the icon (at most once a day). Members see nothing new. Nobody can change anyone else's status, and only admins can see it.
- Someone counts once they open the app from the icon after this release is installed. People who already have the icon show up the next time they use it.
- Includes everything in Release 1.2. The iPhone note under the steps is now one line near the top of the home-screen section of `app.js` (`const IPHONE_NOTE = ...`), so you can change its wording without it turning into a numbered step.

**How to install**
1. In Supabase, open the **SQL Editor**, paste in `supabase/migration_home_screen.sql` and press **Run**. It's safe to run again.
2. Upload `app.js`, `styles.css`, `index.html` and `README.md` to your GitHub repository. Keep your own `config.js`.
3. Refresh the site, then open it once from your own home-screen icon. You should see yourself counted in Admin → Members.

If you upload the files before running the SQL, nothing breaks: Admin → Members shows a short note asking for the SQL file instead of the count.

**Database change:** one new table, `home_screen` (one row per member: phone type and first/last time opened from the icon), which only admins can read, and one function, `mark_home_screen()`, which only ever marks the signed-in, approved member. Supabase's Security Advisor will list this function under the same "authenticated can execute" warning as the app's other functions. That's expected.

Builds on Release 1.2 (no database change) and Release 1.1 (email templates and two SQL files: see RELEASE-1.1.md if you skipped it).
