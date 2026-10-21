# Real SocialDads – Pre-release (before Release 1)

**What's in it:** one new Admin setting, **Draw rules**: who can see a game's draw rules (like "Ben and Tom play apart") on the game page once teams are saved.
- **Everyone**: the default, same as now.
- **Organisers**: organisers and admins only.
- **Nobody**: hidden on game pages (admins still get them in the backup file).

Organisers always see the rules while they're drawing, and the New game page tells them who will see them. Nothing else changes: same look, same features as your current site.

**How to install**
1. In the Admin tab, tap **Download backup** (just in case).
2. Upload these files to your GitHub repository, replacing the old ones: `app.js`, `styles.css`, `index.html`, `README.md` (and the `supabase/` folder to keep the latest SQL on file). **Don't change `config.js`**: it isn't in this pack.
3. In Supabase → **SQL Editor → New query**, paste in the whole of `supabase/migration_rules_visibility.sql` and press **Run**. It should say "Success". It's safe to run twice.
4. Open the site (refresh if it looks unchanged: Ctrl+Shift+R / Cmd+Shift+R), go to **Admin → Draw rules** and pick who can see them.

**What the database update does:** it moves each game's draw rules into their own protected table, which only gives them to the people your setting allows (admins can always read them for the backup). Rules from games you've already played move across automatically, and new games file theirs there when they're saved. No games, players, scores, goals or votes are changed.
