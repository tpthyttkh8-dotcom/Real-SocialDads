# Real SocialDads – Release 1

**What's in it**
- The current look (no visual changes).
- Edit a saved line-up for late drop-outs: replace a player, add a new guest in their place, or swap two players between teams. Everyone else keeps their spot on the pitch.
- **Admins can correct the line-up after the final score is in** (organisers can only edit before). Replacing someone passes their goals and man of the match votes to the new player; swapping teams updates wins and losses, and clears a moved player's goals to re-enter only if they no longer fit the new team's score.
- Man of the match star on the shared pitch picture.
- Admin: **Members**, **Players** and **Draw rules** now fold away. Tap a heading to open or close it. Waiting for approval, Invite someone new and Back up your data stay open.
- Admin → **Draw rules**: who can see a game's draw rules on its page (everyone / organisers and admins / nobody). This is the Pre-release setting, included here so installing Release 1 keeps it.

**How to install**
1. In the Admin tab, tap **Download backup** (just in case).
2. Database: in Supabase → **SQL Editor → New query**, paste in the whole of `supabase/migration_release_1.sql` and press **Run**. It contains everything Release 1 needs (including the Pre-release draw rules part, so it's fine if you've already installed that). It's safe to run twice.
3. Upload these files to your GitHub repository, replacing the old ones: `app.js`, `styles.css`, `index.html`, `README.md` (and the `supabase/` folder if you want the latest SQL on file).
4. **Don't upload or change `config.js`.** It isn't in this pack, so yours stays as it is.
5. Wait a minute, then open the site. If it looks unchanged, refresh (on a computer: Ctrl+Shift+R / Cmd+Shift+R).

**If you installed any of updates v5, v6 or v7**
This release puts the site back to the current look without player cards or awards (they return in Release 2). Nothing in your database is lost. The extra `app_features` table from v5 can stay; Release 2 uses it.
