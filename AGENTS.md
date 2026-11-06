# AGENTS.md — Project Architecture & Coding Guidelines

## 1. Project Overview
This is a client-side browser coding puzzle game built with **React**, **Phaser 3**, **TypeScript**, and **Vite**.
Players write JavaScript/TypeScript logic in an in-game **Monaco Editor** (e.g., an `update()` loop and sequential commands) to control a robot character inside a Phaser 3 scene.

## 2. Tech Stack
- **Framework / UI:** React 18+ (`src/App.tsx`, `src/Editor.tsx`)
- **Code Editor:** Monaco Editor (`0.52.2`) loaded dynamically via jsDelivr CDN AMD loader in `src/Editor.tsx` (NO `@monaco-editor/react` npm dependency).
- **Game Engine:** Phaser 4 (`src/PhaserGame.tsx`, `src/game/`)
- **React <-> Phaser Bridge:** `EventBus` (`src/game/EventBus.ts`)
- **Language & Build:** TypeScript + Vite (`vite/config.dev.mjs`, `vite/config.prod.mjs`)

## 3. Architecture & EventBus Protocol
- **React -> Phaser Events:**
  - `EventBus.emit('run-code', code: string)`: Sent when the player clicks Run.
  - `EventBus.emit('stop-code')`: Sent when the player clicks Stop.
- **Phaser -> React Events:**
  - `EventBus.emit('code-started')`: Notifies React that compilation succeeded and the tick loop is running.
  - `EventBus.emit('code-stopped')`: Notifies React that execution was stopped.
  - `EventBus.emit('code-error', errorMsg: string)`: Stops execution and displays the error banner in React.

2. **Player Code Execution Model:**
   - The project source code is written in **TypeScript**, while the player writes **JavaScript** (with TypeScript autocomplete definitions injected into Monaco via `addExtraLib`).
   - When the player clicks **Run**, the player's code string is sent via `EventBus` to Phaser.
   - The player's code is compiled **once per run** using `new Function(...)` so top-level variables (e.g., `let counter = 0;`) persist across ticks via closure.
   - A Phaser `TimerEvent` calls the extracted player `update()` function on a fixed tick rate (e.g., every 100ms / 10 Hz), while Phaser's main `update()` loop smoothly interpolates character movement at 60 FPS.

## 4. Safety & Sandboxing Rules
When modifying or extending the player code runner:
- **Never execute player code on a backend server.** All execution must remain 100% client-side.
- **Global Shadowing:** Always shadow browser globals (`window`, `document`, `fetch`, `localStorage`, `eval`, `Function`, `globalThis`, `self`) in the `new Function()` parameter list and enforce strict mode via an inner IIFE so player code cannot leak variables onto `window` or escape the sandbox.
- **Infinite Loop Protection:** Maintain loop-counter injection on `while`, `for`, and `do...while` loops (with declarations placed safely at the script top and reset on each `update()` tick) so a single tick exceeding the iteration threshold throws an error without breaking single-statement conditional blocks.
- **Error Handling:** Always wrap both code compilation and each tick execution in `try / catch` blocks. On error, stop the timer immediately and emit an event back to React to display a friendly error message to the player.

## 5. Adding New Robot Commands (Checklist for Teammates & AI)
Whenever you add a new command for the player (e.g., `jump()`, `canSeeEnemy()`, or utilities like `track()`):
1. **Implement in Phaser (`src/game/scenes/Game.ts`):** Create the method that updates or reads the robot's state.
2. **Expose to Sandbox (`src/game/scenes/Game.ts`):** Pass the function into the `new Function(...)` argument list when compiling player code.
3. **Optional — Editor Autocomplete (`src/Editor.tsx`):** Register the function signature using `window.monaco.languages.typescript.javascriptDefaults.addExtraLib(...)` inside `Editor.tsx` after Monaco initializes.

## 6. Code Style & Team Conventions
- Write all project code in strict **TypeScript** (avoid `any` where possible).
- Write clear, plain-English comments explaining non-obvious logic (especially regex transforms, closures, and Phaser-React event bridges) so all group members can easily follow the code.
- Keep components small: Sandbox and code execution logic lives in `src/game/CodeRunner.ts`, HUD rendering in `src/game/GameHUD.ts`, and character logic in `src/game/Robot.ts` (when extracting robot behaviors).