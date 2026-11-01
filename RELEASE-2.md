# Real SocialDads – Release 2

**What's in it:** balanced teams, player cards, an awards page you can edit, and a season picture for WhatsApp. The cards, awards page and season picture stay hidden from players until an admin switches them on.

- **Balanced teams** (added 31 Oct 2026): on New game, organisers choose **Balanced** or **Random**. Balanced evens the teams out using past results (who played on which team, and the final score), allowing for who people played with. It keeps every draw rule, and **Shuffle again** still gives different teams, all of them fair. One line under the pitch shows each team's chance of winning, like **Balance 52% / 48%**. Nobody's own score is shown anywhere. It's picked automatically once there are 4 games with a final score; new players and guests count as average.
- **Player cards:** tap a name in Stats, on a finished game's pitch, or on the Awards page. A card shows games, W-D-L, win rate, goals, man of the match awards, recent form, best teammate and nemesis, and every game that season. Your own card is also on your profile.
- **Early form:** a player with fewer than 5 games in the season sees "Early form: based on N games. Cards settle after 5 games", with an "N of 5" marker. It disappears at 5 games.
- **Awards page** (from Stats): Golden Boot, Star Man, Always the Bridesmaid, Ever-present, Lucky Charm, Sharpshooter, The Wall and On Fire, worked out from every finished game in the season. Ties share the award. If nobody has played an award's minimum games yet, the leader so far shows as **Provisional**.
- **Edit awards** (admins, from the Awards page or Admin → Features): rename any award, change its icon, description or games needed, switch any off, or add your own, like a Wooden Spoon for most defeats. Your own awards can be deleted; the standard ones can be switched off or put back to the original. Changes show straight away, past seasons included.
- **Season picture:** a picture of the season's award winners, games and goals, to share in WhatsApp or save.
- **Last on the app** (admins only): Admin → Members shows when each member last opened the app and whether it was the browser or the home-screen app, plus how many have been on in the last 7 days. It's recorded automatically (at most every 15 minutes). Members see nothing new and can only ever mark themselves.
- **Still to do** on a finished game (admins, and the organiser who drew it): who hasn't added their goals yet and who hasn't voted for man of the match, with when each was last on (admins). Anyone not on since the game is marked. **Copy a reminder** makes a WhatsApp message naming them, with a link to the game. It shows who still has to vote, never who anyone voted for.
- **Admin → Features:** switch player cards, the awards page and the season picture live when you're ready. While one is off, only admins can see it (with a "Preview" note), so you can try it first.
- Includes everything in Releases 1.1, 1.2 and 1.3.

**How to install**
1. In Supabase, open the **SQL Editor**, paste in `supabase/migration_release_2.sql` and press **Run**. It's safe to run again.
2. Upload `app.js`, `draw.js`, `styles.css`, `index.html` and `README.md` to your GitHub repository. Keep your own `config.js`. **`draw.js` changes in this release** (it holds the balanced draw), so don't skip it.
3. Refresh the site. Balanced teams works straight away for organisers. Everything else new is admin-only until you switch it on in **Admin → Features**.

If you upload the files before running the SQL, nothing breaks: admins see the previews with a note asking for the SQL file, and the standard awards are used.

**Database change:** none for balanced teams (it works from the games already saved, on the organiser's phone). For the rest, three new tables. `app_features` (the three switches) and `awards` (the award list, with the eight standard awards added for you) can be read by approved members and changed only through admin-only functions: `set_feature`, `save_award`, `set_award_enabled` and `delete_award`. `last_seen` (one row per member: when, browser or home screen, phone type) can only be read by admins and is only written by `mark_seen()`, which marks the signed-in member and nobody else. `motm_waiting()` lists who in a game hasn't voted yet, for admins and that game's organiser only. Signed-out visitors can't use them. Supabase's Security Advisor will list these under the same "authenticated can execute" warning as the app's other functions. That's expected.

Skipped an earlier release? Its database steps still apply: Release 1.1 (email templates, `migration_view_security.sql`, `migration_function_permissions.sql`) and Release 1.3 (`migration_home_screen.sql`). See RELEASE-1.1.md and RELEASE-1.3.md.
