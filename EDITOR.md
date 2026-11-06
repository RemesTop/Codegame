# In-Game Code Editor Guide

This guide explains how the code editor works, what commands you can use, and how your code controls the game character.

---

## 1. What is the editor?

The code editor on the right side of the screen is powered by Monaco Editor (the same open source editor used in Visual Studio Code). It runs entirely inside your browser, so you do not need to install anything on your computer.

You write standard JavaScript in the editor.

---

## 2. How your code runs: The Tick Loop

When you press the Run button, the game reads and compiles your script once.

The game then calls your `update()` function repeatedly on a timer:
* **Tick Rate:** Exactly once every 100 milliseconds (10 times every second).
* **Game Render Rate:** The game screen itself draws at 60 frames per second. This means character movement stays smooth even though your code logic thinks in 100ms steps.

Any variables you declare outside the `update()` function stay alive between ticks. For example:

```javascript
let counter = 0;

function update() {
  counter++; // counter keeps growing every 100ms
}
```

---

## 3. Available Player character Commands

Your code controls the red square character in the game view using these built-in functions:

### `moveRight()`
Tells the character to start moving right continuously. It will keep moving right on each frame until you tell it otherwise.

### `moveLeft()`
Tells the character to start moving left continuously. Calling this automatically cancels rightward movement.

### `stop()`
Stops all horizontal movement immediately. The character stays where it is.

### `track(variable)`
Displays the value of a variable in a small box in the top right corner of the game view. 

* You only need to call `track()` once at the top of your script during initialization.
* The game automatically watches that variable and updates the display whenever the value changes.
* You can track multiple variables at the same time. Each one will appear on its own line.

Example:
```javascript
let counter = 0;
let status = "READY";

// Track both variables on the screen
track(counter);
track(status);

function update() {
  counter++;
  if (counter < 20) {
    status = "MOVING RIGHT";
    moveRight();
  } else {
    status = "STOPPED";
    stop();
  }
}
```

---

## 4. Editor Features

### Autocomplete & Hover Docs
As you type, Monaco will suggest available commands (`moveRight`, `moveLeft`, `stop`, `track`). You can press Enter or Tab to accept a suggestion. Hovering your mouse over any command displays a short explanation of what it does.

### Run & Stop Toggle Button
* When the game is idle, click the green **▶ Run** button to start executing your code.
* While the game is running, the button changes to a red **⏹ Stop** button. Clicking it stops the timer and returns the character to the center of the screen.

### Error Messages
If your code has a syntax mistake (like a missing curly brace) or encounters a runtime error, execution stops immediately and a red error banner appears at the bottom of the editor explaining what went wrong.

---

## 5. Built-in Safety Features

### Infinite Loop Protection
If you accidentally write a loop that never ends (such as `while (true) {}`), the editor catches it. If any single tick runs more than 10,000 loop iterations, the game automatically stops and displays a clear error message instead of freezing your browser tab.

This protection works for:
* Regular `while` loops
* `for` loops
* `do ... while` loops
* Single line loops without curly braces (like `while(true);`)

### Strict Mode
Your code runs in JavaScript strict mode. This helps you avoid common coding mistakes:
* If you forget `let` or `const` when creating a variable (like writing `x = 5;`), the editor throws an error telling you the variable is not defined, instead of creating hidden global variables.

### Safe Browser Sandbox
To keep your browser secure, dangerous browser functions (such as `window`, `document`, `eval`, and page redirects) are blocked inside the player code environment. Your code can only interact with the game through the provided robot commands.

---

## 6. Example Starter Script

Here is a complete starter script demonstrating counters, conditionals, and movement:

```javascript
// Javascript
let counter = 0;

track(counter);

// update() function runs every 100ms
function update() {
  counter++;

  if (counter < 20) {
    moveRight();
  } else if (counter < 40) {
    moveLeft();
  } else {
    stop();
  }
}
```

