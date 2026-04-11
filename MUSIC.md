# Music Behavior

## Track Selection

| Condition | Track |
|---|---|
| Music ON, Rave mode OFF | Softly Falling Blocks |
| Music ON, Rave mode ON | Cyber Jurassic Tetris |
| Music OFF | Silence |

## When Music Plays vs. Stops

| Screen / State | Music |
|---|---|
| Active game (playing) | Plays |
| Pause screen | Plays (same track) |
| "Ready?" countdown | Plays (same track, already started) |
| Main menu (start screen) | Silent |
| Game over screen | Silent |

## State Transitions

| Transition | Action |
|---|---|
| Game start | `seekToStart()` then `play()` |
| Resume saved game | `play()` then start countdown |
| Pausing | Music keeps playing into pause screen |
| Unpausing | `play()` fires after "Ready?" finishes |
| Quit to menu | `gameRunning=false`, `pause()` |
| Game over | `gameRunning=false`, `pause()` |
| Music toggle OFF | `pause()` |
| Music toggle ON (in game) | `play()` |
| Rave mode toggle (in game) | `play()` — picks new track via `desiredPlayer()` |
| Lock screen / app background | `pause()` |
| App foreground (active game only) | `play()` only if `gameRunning && !paused` |
