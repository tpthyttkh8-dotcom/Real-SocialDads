# Real SocialDads

A small web app for a weekly 5, 6, 7 or (rarely) 8-a-side game among friends.

- **Sign in with just an email address.** No password, and no GitHub account needed. Friends get a link (or a 6-digit code) by email
- **Random team draw** shown on a pitch, with players dropping into place
- **Draw rules:** keep chosen players on the *same* team (e.g. a guest with whoever invited them) or on *opposite* teams
- **Regulars can run the draw:** the admin can give any member the "organiser" role
- **Every line-up is saved** and can be reviewed any time
- **A fresh season each calendar year:** games and stats run 1 Jan to 31 Dec, and past years stay viewable
- **Merge a guest into a member** when they join, so their history carries over
- **Share to WhatsApp:** one tap sends the line-up (or result) to your group chat
- **Record the final score** and who played
- **Players add their own goals** after each game
- **Anonymous man of the match vote** for every game
- **Stats per player:** games played, W/D/L, team goals for and against (totals and per game), own goals (total and per game) and man of the match awards

It's a static site (no build step) hosted free on **GitHub Pages**, with **Supabase** (free tier) providing the database and sign-in. Only *you* need a GitHub account (to host the site).

---

## Setup (about 30 minutes, once)

You'll need a GitHub account, a free Supabase account, and an email account you can send from (see step 4).

### 1. Create the Supabase project
1. Go to <https://supabase.com>, sign in, and click **New project**. Pick any name and region, and save the database password somewhere safe.
2. When it's ready, open **SQL Editor → New query**, paste in the whole of `supabase/schema.sql`, and click **Run**.
   **Do this before anyone signs in.**
3. Open **Project Settings → API** and note the **Project URL** and the **anon / publishable key**.

### 2. Put your project details in `config.js`
Replace `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The anon key is meant to be public. **Never** paste the `service_role` / secret key anywhere in this project.

### 3. Host it on GitHub Pages
1. Create a new GitHub repository (public is fine; the anon key is designed to be public).
2. Upload all of these files to it (or push with git).
3. In the repo go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute your site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`. Note that exact address, including the trailing `/`.

### 4. Set up email sign-in (important: needs your own email sender)
Supabase's built-in email service is for testing only: it sends about 2 emails an hour and **only to people on your Supabase team**, so your friends would never receive a link. You need to plug in your own email account. It's a one-off job:

1. Pick a sender. Any of these work, and you should check their current free limits:
   - **Gmail** (simplest if you have one): turn on 2-Step Verification, then create an **App Password** in your Google account. Host `smtp.gmail.com`, port `587`, username = your Gmail address, password = the app password.
   - **Brevo** (free plan): verify a sender email address (no domain needed), then use the SMTP details from Brevo's *SMTP & API* page.
   - **Resend / SendGrid / etc.** also work, but most make you verify a domain you own first.
2. In Supabase go to **Authentication → Emails → SMTP Settings**, switch on **Custom SMTP**, and enter the host, port, username, password and a sender address/name.
3. Still in **Authentication → Emails → Templates**, edit **both** the **Magic link** and the **Confirm sign up** templates (new friends get the second one the first time). Set the subject to something like `Your Real SocialDads sign-in` and paste this as the body, so the email contains the link *and* a code:

```html
<h2>Sign in to Real SocialDads</h2>
<p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
<p>Or type this code into the app: <b>{{ .Token }}</b></p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

4. Go to **Authentication → URL Configuration** and set:
   - **Site URL:** your GitHub Pages address
   - **Redirect URLs:** add `https://YOUR-USERNAME.github.io/YOUR-REPO/**`

### 5. First sign-in
Open your site, enter your email and tap the link (or type the code). **The first person to sign in becomes the admin**, so make sure that's you. You'll be asked what to call yourself; that name appears on the pitch and in the stats.

Send the site address to your friends. When they sign in and enter their name they'll see "Waiting for approval". Approve them in the **Admin** tab (it shows their email so you know who's who) and they're in.

### 6. Add it to your home screen (optional but nice)
- **iPhone:** open the site in Safari → Share button → **Add to Home Screen**
- **Android:** open it in Chrome → ⋮ menu → **Install app** / **Add to Home screen**

### Optional: GitHub sign-in as well
Set `ENABLE_GITHUB = true` in `config.js`, then in Supabase enable **Authentication → Providers → GitHub** using a GitHub OAuth App (callback URL = the one Supabase shows you). Most groups don't need this.

---

## Signing in: how often?

Not every time. Once someone has signed in on a phone they **stay signed in on that device** until they tap *Sign out* (in the profile page, top-right avatar) or clear their browser data. A new link or code is only needed on a new device or after signing out.

Two small things to know:
- **iPhone home-screen app:** it keeps its own storage separate from Safari, and the emailed link opens in Safari. So if someone signs in from the home-screen icon, they should **type the 6-digit code** instead of tapping the link.
- Links work once. Some email apps "pre-open" links and use them up. If a link says it has expired, the code in the same email still works, or just request a new one.

## The weekly routine

1. **An organiser:** *New game* → pick the date and format → tick who's playing (the counter turns green at exactly 10, 12, 14 or 16). Someone brought a mate? Type their name under the player list and tap **Add guest**. Then **Draw teams**. Tap **Shuffle again** if you want another draw, then **Save game**.
2. **Share it:** on the saved game, tap **Share to WhatsApp**, pick your group chat, and send.
3. **After the match, an organiser:** open the game and **Save final score**.
4. **Everyone who played:** open the game, enter **your own goals**, and **vote for man of the match**. Matches in the list show "Add your goals" and "Vote man of the match" badges until you've done them.
5. Voting **closes automatically** once everyone who has a login has voted. An organiser can also close it early (**Close voting and reveal**) and can reopen it. Man of the match awards count in the stats once voting is closed. If two players tie, both get the award.

**Guest players** (people who don't sign in) can be picked for teams and an organiser can enter their goals, but they can't vote.

### Draw rules

Once you've picked the players, a **Draw rules** card appears:
- **Play together:** pick 2 or more players who must end up on the same team (a guest and the friend who invited them, say).
- **Play apart:** pick exactly 2 players who must end up on opposite teams.

You can add as many rules as you like. The app tells you straight away if rules clash (for example "together" and "apart" for the same pair) or can't fit the team sizes. Within the rules the draw is still fully random, and a group set to play together is just as likely to land on Blue as on Orange. If you untick a player, any rules involving them are removed.

### The pitch and formations

Each team is shown on the pitch in a fixed shape, goalkeeper at the back:

| Format | Formation |
|---|---|
| 5-a-side | 1 - 2 - 2 |
| 6-a-side | 1 - 3 - 2 |
| 7-a-side | 1 - 3 - 3 |
| 8-a-side | 1 - 3 - 3 - 1 |

Players are placed in the shape at random, so the player at the back is just the first one drawn. Swap keepers between yourselves if you need to. The pitch grows to fit every row so no names are cut off, and if two players share a first name both get a last initial (for example "Tom O." and "Tom B.").

### Team names and colours (just for fun)

On the New game page, give each team a name and pick its colour from eight options (red, orange, yellow, green, blue, purple, black, white). Leave a name blank and the team is simply called by its colour. Picking the colour the other team already has swaps the two. The names and colours show on the pitch, the scores, the goal lists and the WhatsApp message (with a matching coloured circle). An organiser can change them later from the bottom of any saved game.

They are purely cosmetic: stats only ever count which side a player was on, never the name or colour, so nothing about the numbers can change. Games with no name or colour set (including every game from before this feature) still show as Blue and Orange.

### Not happy with the draw?

After you tap **Draw teams**, the button changes to **Shuffle again**, sitting next to **Save game** under the pitch. Shuffle as many times as you like. Nothing is recorded until you tap **Save game**, and your draw rules stay in place for every reshuffle.

### Who can do what

| | Everyone approved | Organiser | Admin |
|---|:--:|:--:|:--:|
| See games, line-ups, stats | ✓ | ✓ | ✓ |
| Record own goals, vote, share to WhatsApp | ✓ | ✓ | ✓ |
| Draw teams, add guests, enter scores, close voting, fill in anyone's goals | | ✓ | ✓ |
| Approve people, give roles, edit players, merge guests, delete games, download backups | | | ✓ |

Admins give the organiser role in **Admin → Members → Let them draw teams**.

---

## Seasons: a fresh start each year

Games and stats run for a **calendar year**. Every game belongs to the year of its date, so on 1 January the Matches and Stats pages start empty for the new season. The numbered year buttons at the top of both pages switch between seasons, and earlier years stay available as an archive (nothing is deleted).

- Stats for a season only count games dated in that year, including goals, goals for/against and man of the match awards.
- A game dated 31 December counts towards that year even if the final score is entered on 2 January.
- Players who haven't played yet this year show with zeros in the current season.

## When a guest joins the group

If a guest later becomes a regular and signs in, you can move their whole history onto their new login:

1. Have them sign in, enter their name, and approve them in **Admin** as usual. They now appear as a player.
2. In **Admin → Players**, find the guest and tap **Merge…**.
3. Choose the new member from the list and confirm.

All of the guest's games, goals, man of the match awards and draw rules move onto the member, across every season, and the guest entry is removed. The member keeps their own name. It **can't be undone**, so check the choice first. Merging is refused if both appeared in the same game (they can't be the same person). Only admins can merge, and only guests can be merged away (never someone with a login). This also works for tidying up a guest entered twice under slightly different names.

---

## Are line-ups recorded? Can I look back?

Yes. When a game is saved, the database stores the date, format, both teams, who drew them, and any draw rules that were set. Every game stays in the **Matches** list, and tapping one shows the pitch with the exact line-up, the score, each player's goals and the man of the match result, whenever you like. Once saved, line-ups can't be changed by organisers (only an admin could, directly in the database), and only an admin can delete a game.

Things worth knowing:
- If someone changes their name in their profile, it updates across past games too.
- The draw itself happens on the organiser's phone, and only the saved result is recorded. Shuffles tried before saving aren't logged.
- Supabase's free plan doesn't guarantee backups, so use **Admin → Download backup** now and then to keep a copy of all your history. (It never includes individual votes.)

## Sharing to WhatsApp

On any game, **Share to WhatsApp** opens WhatsApp with a ready-made message: the date, format, both line-ups, the final score once it's in, and a link to the game in the app. You pick the group and press send. **Copy text** does the same for any other app.

The app can't post into a group *by itself*. WhatsApp only allows that through its paid business tools, and a one-tap share is what's available for free. The link only opens for people who've signed in to the app.

---

## How the anonymous vote works

Votes are stored in two separate tables: one records *that* you voted (to stop double voting), the other records *who received a vote* with nothing linking back to the voter. The app and every normal user have no way to see who voted for whom, and vote counts are hidden until voting closes.

Be aware that whoever owns the Supabase project (you) could in theory dig through the raw database. That's the case for any small app like this, and the app never exposes it.

---

## Rules built into the database

These are enforced by the database itself (Row Level Security), not just the screen, so they hold even if someone pokes at the app:

- Only **approved** people can see anything.
- Only **organisers and admins** can create games, enter scores and add guests; only **admins** can approve people, give roles, edit players or delete games.
- You can only record **your own goals** (organisers and admins can do anyone's), between 0 and your team's score.
- You can only vote in games **you played**, once, and not for yourself.

---

## Updating an existing install safely

When an update comes with a `migration_….sql` file, run it once in Supabase (SQL Editor → New query → Run) and re-upload the changed site files. The migrations only **add** optional columns, recreate saved queries (views) and replace functions. They don't delete or overwrite your games, players, scores or goals, and they're safe to run twice. As a precaution, tap **Admin → Download backup** first.

## Customising

- **App name:** `APP_NAME` in `config.js`.
- **Default team colours:** a game with no choice set shows Blue and Orange. The colour options live in `PALETTE` at the top of `app.js` and the `.tc-…` rules in `styles.css`.
- **Colours and look:** the variables at the top of `styles.css`. It follows each phone's light/dark mode.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Almost there" screen | `config.js` still has the placeholder URL/key. |
| Friends never receive the email | Custom SMTP isn't set up (step 4). Supabase's built-in sender only emails your own team. Check spam too. |
| "Email rate limit exceeded" | Too many emails requested in a short time. Wait a few minutes. With custom SMTP the limit is much higher. |
| Email arrives but has no code | The Magic link / Confirm sign up templates need the `{{ .Token }}` line (step 4.3). |
| Link lands on a blank page or an error | Check Site URL / Redirect URLs in Supabase (step 4.4) match your GitHub Pages address exactly. |
| "No profile found" | That email signed in before you ran `schema.sql`. In Supabase → Authentication → Users, delete the user and sign in again. |
| "Couldn't load … relation does not exist" | `schema.sql` wasn't run (or failed). Run it again; it's safe to re-run. |
| Nobody is admin | In Supabase → Table Editor → `profiles`, set `is_approved` and `is_admin` to true on your row. |
| Site is slow to wake after a quiet spell | Supabase free projects can pause when unused for a while. Open the Supabase dashboard and click **Restore**. |

## Files

```
index.html          page shell
app.js              the app screens and logic
draw.js             the random draw and its rules (kept separate so it can be tested)
styles.css          styling
config.js           your Supabase URL + key (edit this)
manifest.json       lets phones install it like an app
icons/              app icons
supabase/schema.sql database tables, security rules, stats views (for a fresh install)
supabase/migration_seasons_merge.sql  one-off update if you installed an earlier version
supabase/migration_lineup_order.sql   one-off update: keeps saved line-ups in the order they were drawn
supabase/migration_team_names_colours.sql  one-off update: fun team names and colours
```

## Keep-alive (stop the free Supabase project pausing)

`.github/workflows/keepalive.yml` pings the database every 3 days.
One-off setup: in GitHub go to **Settings -> Secrets and variables -> Actions -> New repository secret** and add
`SUPABASE_URL` (e.g. `https://xxxx.supabase.co`, no trailing slash or `/rest/v1`) and `SUPABASE_KEY` (the publishable key).
Then open the **Actions** tab, pick *Keep Supabase awake* and press **Run workflow** once to check it shows a green tick.
Note: GitHub switches scheduled workflows off after 60 days with no repository activity; re-enable it from the Actions tab if that happens.
If the project is ever paused, press **Restore** in the Supabase dashboard (your data is kept).

## Goals rule (collective goals)

Personal goals recorded for a team can't exceed that team's final score. Existing installs: run `supabase/migration_collective_goals.sql` once (the corrected version in this pack).
