# AGENTS.md — Project Architecture & Coding Guidelines

## 1. Project Overview
This is a client-side browser coding puzzle game built with **React**, **Phaser 4**, **TypeScript**, and **Vite**.
Players write JavaScript logic in an in-game **Monaco Editor** (e.g. an optional one-time `start()` sequence, an `update()` loop, `sleep()` pauses, and movement commands) to control a character inside a Phaser scene.

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
  - `EventBus.emit('code-started')`: Notifies React that compilation succeeded and execution has started.
  - `EventBus.emit('code-stopped')`: Notifies React that execution was stopped.
  - `EventBus.emit('code-error', errorMsg: string)`: Stops execution and displays the error banner in React.

### Player Code Lifecycle & Execution Model
1. **Compilation & Scope:**
   - The player writes standard JavaScript.
   - When Run is clicked, the code is compiled once inside a sandboxed factory function (`compilePlayerCode` in `src/game/CodeRunner.ts`).
   - Top-level variables (e.g. `let counter = 0;`) persist across ticks via JavaScript closure.
2. **Lifecycle Execution (`start` -> `update`):**
   - **`start()` (Optional):** If defined, runs exactly once immediately on Run. If `start()` calls `sleep(ms)`, it blocks sequentially until complete before `update()` begins.
   - **`update()` (Optional/Loop):** Runs repeatedly on a fixed Phaser `TimerEvent` tick rate (every 100ms / 10 Hz).
3. **`sleep(ms)` & Concurrency Control:**
   - `injectAsyncSleep` auto-converts `function start(` / `function update(` into `async` and prefixes `sleep(` with `await` so players never need to write `async/await` manually.
   - `isUpdating` flag in `CodeRunner` prevents overlapping ticks while an `update()` is sleeping.
   - `currentRunId` token: Clicking Stop or restarting Run cancels pending `sleep()` timers immediately (`__EXECUTION_ABORTED__`) to prevent zombie callbacks from moving the character after stopping.
4. **Rendering & Kinematics:**
   - Phaser's main `update()` loop runs at ~60 FPS and smoothly accelerates and decelerates horizontal velocity (`velocityX`, `accelerationX`, `decelerationX`, `maxSpeedX`).
   - Kinematics are strictly isolated to the X-axis so future Y-axis gravity and jump mechanics remain completely independent.

## 4. Safety & Sandboxing Rules
When modifying or extending the player code runner:
- **Never execute player code on a backend server.** All execution must remain 100% client-side.
- **Global Shadowing & Strict Mode:** Shadow browser globals (`window`, `document`, `fetch`, `localStorage`, `eval`, `Function`, `globalThis`, `self`) as `undefined` in the `new Function()` parameter list. Keep an inner IIFE with `"use strict";` so undeclared variables cannot leak onto the global window object.
- **Infinite Loop Protection:** `injectLoopProtection` scans `while`, `for`, and `do...while` loops (including single-statement braceless loops and deeply nested condition parentheses). It resets a single top-level `let __loopCount = 0;` at the start of `start()` and `update()` so tick executions exceeding 10,000 iterations throw an error without breaking single-statement `if` blocks.
- **Error Handling:** Wrap compilation and tick execution in `try / catch` blocks. On error, stop timers immediately, reset the scene, and emit `code-error` to React to display a friendly message.

## 5. Adding New Robot Commands (Checklist for Teammates & AI)
Whenever you add a new command for the player (e.g. `jump()`, `canSeeEnemy()`, or utilities like `track()`):
1. **Implement in Game Scene / Character (`src/game/scenes/Game.ts` or `Robot.ts`):** Create the method that reads or mutates game state.
2. **Expose in `RobotAPI` (`src/game/CodeRunner.ts`):** Add the function signature to `RobotAPI` interface and pass it through `compilePlayerCode` into the sandbox arguments.
3. **Wire in `Game.ts`:** Bind the implementation to the API object passed into `new CodeRunner(this, api, ...)`.
4. **Editor Autocomplete & Hover (`src/Editor.tsx`):** Add the function signature and JSDoc comment into `gameApiDefs` inside `Editor.tsx`.
5. **Document in Player Guide (`EDITOR.md`):** Add a clear, beginner-friendly explanation and code example in plain English (avoid em dashes).

## 6. Code Style & Team Conventions
- Write all project code in strict **TypeScript** (avoid `any` where possible).
- Write clear, plain-English comments explaining non-obvious logic (especially regex transforms, closures, and Phaser-React event bridges) so all group members can easily follow the code.
- **Component Responsibilities:**
  - `src/game/CodeRunner.ts`: Sandboxing, code compilation, loop protection, `sleep` management, and the `start()` / `update()` tick loop.
  - `src/game/GameHUD.ts`: HUD display for tracked variables (configured with `resolution: 2` and pixel snapping to prevent blurriness).
  - `src/game/Player.ts`: Player character entity, horizontal kinematics (acceleration/deceleration), Arcade Physics body, and movement controls.
  - `src/game/scenes/Game.ts`: Phaser scene initialization, platform layout, physics collisions, and event bridges.
  - `src/Editor.tsx`: Monaco editor integration, AMD CDN loading, autocomplete definitions, and hover providers.