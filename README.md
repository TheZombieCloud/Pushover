# Pushover

A daily puzzle where the player must push every other slime off a floating island in a few turns.

## How it works

Each day there is a new island released, typically with 2 to 5 slimes on it. The player is the slime with the crown and must then push as many of the other slimes off the island as possible in 4 or 5 turns. On each turn every slime shows an arrow for the move it is about to make. The player drags from their slime to aim and presses push, and then all of the slimes move at the same time. If the player falls off the island the run ends but the player keeps the slimes that were already pushed off.

There are 5 kinds of slimes:

- Chasers charge at the player
- Dodgers keep away from the player and from the edge
- Mirrors do the opposite of whatever the player does
- Sleepers do not move
- Bombs do not move, but the first time something hits one it blasts every slime near it away

None of the slimes will ever move off the island by themselves. The player can play each island as many times as they want, and each island has a leaderboard (most slimes pushed off first, then fewest runs). The player can also build an island in the editor, and once the player has beaten it the player can post it from their own account as its own post with its own leaderboard (up to 5 a day).

The islands get harder through the week (2 slimes on Monday and 5 on Sunday), and every day except Monday has its own extra rule:

- Tuesday: bumpers that fling back whatever hits them
- Wednesday: boulders that everything bounces off
- Thursday: cracked grass that falls away once a slime has slid off it, so the island shrinks as you play
- Friday: the island is frozen so everything slides further, and fences along parts of the coast bounce slimes back
- Saturday: wind that bends every slide, and a bomb
- Sunday: boulders, ice and a bomb

Each island also has a bonus star for players who can already clear it: either clearing it with a turn to spare, or pushing two slimes off with one push. The star is shown next to the score and does not change it.

## For moderators

When the app is installed it posts the first island, and after that it posts a new island each day at midnight UTC. No setup is needed.

These are the menu items (in the subreddit menu unless stated):

- **Pushover: post today's island** posts the daily island by hand.
- **Pushover: re-roll today's island** replaces the daily island with a new one (best for a day few players have played).
- **Pushover: post a test island** posts a random island with its own leaderboard.
- **Pushover: add scores comment to old posts** adds the stickied scores comment to posts that were made before the app had it, and the "Daily" flair to past daily posts (new posts get both when they are made). It can be run more than once.
- **Pushover: stats for this island** (in the post menu) shows how many players opened, started and finished the island, as well as how many fell off and how many pushed every slime off.
- **Pushover: reset my runs here (testing)** (in the post menu) removes the moderator's own runs on that post so that it plays as new.

The app also adds a "Daily" post flair to the subreddit and puts it on each daily island post. Test islands and islands that players built do not get it.

## What the app does as the player

- It posts the player's score as a comment from the player's account, only when the player presses the "Comment my score" button. The comment is a reply to one stickied comment that the app keeps on each post, so that scores stay out of the way of other comments.
- It posts an island that the player built as a new post from the player's account, only when the player presses the "Post island" button. The player can delete the post like any other post, and the app then removes the island and its leaderboard.
- It follows the subreddit for the player, only when the player presses the follow button.
- It sets the player's user flair to their streak and their bonus stars (e.g. "Pushover · 3-day streak", then "★ 4 · Pusher · 3-day streak"). The flair gets a grander title and colour as the stars add up: Pusher from 1 star, Shover from 10, Knockout from 25, Slime Royalty from 50 and Island Legend from 100. It does not replace a flair that the player or a moderator chose.

## Data

The app stores each player's runs, scores, streak and when they last played under their username. Any player can remove all of it with **Pushover: delete my data** in the subreddit menu. When a post is deleted or removed the app also removes what it stored for that post.

Notes on the code are in DEVELOPMENT.md.
