# Pushover

A daily puzzle where the player must push every other slime off a floating island in a few turns.

## How it works

Each day there is a new island released, typically with 2 to 5 slimes on it. The player is the slime with the crown and must then push as many of the other slimes off the island as possible in 4 or 5 turns. On each turn every slime shows an arrow for the move it is about to make. The player drags from their slime to aim and presses push, and then all of the slimes move at the same time. If the player falls off the island the run ends but the player keeps the slimes that were already pushed off.

There are 4 kinds of slimes:

- Chasers charge at the player
- Dodgers keep away from the player and from the edge
- Mirrors do the opposite of whatever the player does
- Sleepers do not move

None of the slimes will ever move off the island by themselves. The player can play each island as many times as they want, and each island has a leaderboard (most slimes pushed off first, then fewest runs). The player can also build an island in the editor, and once the player has beaten it the player can post it from their own account as its own post with its own leaderboard (up to 5 a day).

The islands get harder through the week (2 slimes on Monday and 5 on Sunday), and on some days there is an extra rule:

- Wednesday: there are boulders that everything bounces off
- Friday: the island is frozen so everything slides further
- Sunday: both

## For moderators

When the app is installed it posts the first island, and after that it posts a new island each day at midnight UTC. No setup is needed.

These are the menu items (in the subreddit menu unless stated):

- **Pushover: post today's island** posts the daily island by hand.
- **Pushover: re-roll today's island** replaces the daily island with a new one (best for a day few players have played).
- **Pushover: post a test island** posts a random island with its own leaderboard.
- **Pushover: add scores comment to old posts** adds the stickied scores comment to posts that were made before the app had it (new posts get it when they are made). It can be run more than once.
- **Pushover: stats for this island** (in the post menu) shows how many players opened, started and finished the island, as well as how many fell off and how many pushed every slime off.
- **Pushover: reset my runs here (testing)** (in the post menu) removes the moderator's own runs on that post so that it plays as new.

## What the app does as the player

- It posts the player's score as a comment from the player's account, only when the player presses the "Comment my score" button. The comment is a reply to one stickied comment that the app keeps on each post, so that scores stay out of the way of other comments.
- It posts an island that the player built as a new post from the player's account, only when the player presses the "Post island" button. The player can delete the post like any other post, and the app then removes the island and its leaderboard.
- It follows the subreddit for the player, only when the player presses the follow button.
- It sets the player's user flair to their streak (e.g. "Pushover · 3-day streak"). It does not replace a flair that the player or a moderator chose.

## Data

The app stores each player's runs, scores and streak under their username. Any player can remove all of it with **Pushover: delete my data** in the subreddit menu. When a post is deleted or removed the app also removes what it stored for that post.

Notes on the code are in DEVELOPMENT.md.
