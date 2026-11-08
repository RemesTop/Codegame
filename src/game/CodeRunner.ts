import { EventBus } from './EventBus';

export interface RobotAPI {
    moveRight: () => void;
    moveLeft: () => void;
    stop: () => void;
    track: (label: string, valueOrGetter?: any) => void;
}

export interface CompiledScript {
    start: (() => Promise<void> | void) | null;
    update: (() => Promise<void> | void) | null;
}

/**
 * Injects infinite loop protection into while, for, and do...while loops.
 * 
 * - Declares a single `let __loopCount = 0;` at the top of the function and resets it in update() and start(),
 *   so unbraced conditionals (e.g. if (c) while (x) { ... }) are not broken by local declarations.
 * - Supports braceless loops (e.g. while(true); or while(true) moveRight();)
 *   by wrapping their bodies into braces { ... }.
 * - Supports do...while loops (e.g. do { ... } while(...) or do stmt; while(...)).
 * - Accurately pairs parentheses for any level of nested parentheses in conditions.
 */
export function injectLoopProtection(code: string): string {
    let loopCount = 0;
    const guard = 'if (++__loopCount > 10000) throw new Error("Infinite loop detected: exceeded 10,000 iterations in a single tick"); ';

    function transformLoops(source: string): string {
        let output = '';
        let i = 0;
        const n = source.length;
        let doWhileDepth = 0;

        function isIdent(ch: string): boolean {
            return /[a-zA-Z0-9_$]/.test(ch);
        }

        function skipSpaceAndComments(pos: number): number {
            while (pos < n) {
                const ch = source[pos];
                if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
                    pos++;
                } else if (ch === '/' && source[pos + 1] === '/') {
                    pos += 2;
                    while (pos < n && source[pos] !== '\n') pos++;
                } else if (ch === '/' && source[pos + 1] === '*') {
                    pos += 2;
                    while (pos < n && !(source[pos] === '*' && source[pos + 1] === '/')) pos++;
                    pos += 2;
                } else {
                    break;
                }
            }
            return pos;
        }

        function findMatchingParen(openPos: number): number {
            let depth = 1;
            let p = openPos + 1;
            while (p < n && depth > 0) {
                const ch = source[p];
                if (ch === '"' || ch === "'" || ch === '`') {
                    const quote = ch;
                    p++;
                    while (p < n && source[p] !== quote) {
                        if (source[p] === '\\') p++;
                        p++;
                    }
                    p++;
                } else if (ch === '/' && source[p + 1] === '/') {
                    p += 2;
                    while (p < n && source[p] !== '\n') p++;
                } else if (ch === '/' && source[p + 1] === '*') {
                    p += 2;
                    while (p < n && !(source[p] === '*' && source[p + 1] === '/')) p++;
                    p += 2;
                } else if (ch === '(') {
                    depth++;
                    p++;
                } else if (ch === ')') {
                    depth--;
                    p++;
                } else {
                    p++;
                }
            }
            return p - 1;
        }

        function findStatementEnd(pos: number): number {
            let parenDepth = 0;
            let braceDepth = 0;
            let p = pos;
            while (p < n) {
                const ch = source[p];
                if (ch === '"' || ch === "'" || ch === '`') {
                    const quote = ch;
                    p++;
                    while (p < n && source[p] !== quote) {
                        if (source[p] === '\\') p++;
                        p++;
                    }
                    p++;
                } else if (ch === '/' && source[p + 1] === '/') {
                    p += 2;
                    while (p < n && source[p] !== '\n') p++;
                } else if (ch === '/' && source[p + 1] === '*') {
                    p += 2;
                    while (p < n && !(source[p] === '*' && source[p + 1] === '/')) p++;
                    p += 2;
                } else if (ch === '(') {
                    parenDepth++;
                    p++;
                } else if (ch === ')') {
                    parenDepth = Math.max(0, parenDepth - 1);
                    p++;
                } else if (ch === '{') {
                    braceDepth++;
                    p++;
                } else if (ch === '}') {
                    braceDepth = Math.max(0, braceDepth - 1);
                    p++;
                    if (braceDepth === 0 && parenDepth === 0) {
                        return p;
                    }
                } else if (ch === ';' && parenDepth === 0 && braceDepth === 0) {
                    return p + 1;
                } else {
                    p++;
                }
            }
            return p;
        }

        function matchesKeyword(pos: number, word: string): boolean {
            if (!source.startsWith(word, pos)) return false;
            const prev = pos > 0 ? source[pos - 1] : ' ';
            const next = pos + word.length < n ? source[pos + word.length] : ' ';
            return !isIdent(prev) && !isIdent(next);
        }

        while (i < n) {
            const ch = source[i];

            // 1. Strings
            if (ch === '"' || ch === "'" || ch === '`') {
                const quote = ch;
                output += quote;
                i++;
                while (i < n && source[i] !== quote) {
                    if (source[i] === '\\') {
                        output += source[i++];
                    }
                    if (i < n) output += source[i++];
                }
                if (i < n) output += source[i++];
                continue;
            }

            // 2. Line comment
            if (ch === '/' && source[i + 1] === '/') {
                while (i < n && source[i] !== '\n') {
                    output += source[i++];
                }
                continue;
            }

            // 3. Block comment
            if (ch === '/' && source[i + 1] === '*') {
                output += '/*';
                i += 2;
                while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
                    output += source[i++];
                }
                if (i < n) {
                    output += '*/';
                    i += 2;
                }
                continue;
            }

            // 4. do ... while loops
            if (matchesKeyword(i, 'do')) {
                loopCount++;
                doWhileDepth++;
                output += 'do';
                i += 2;

                const afterDo = skipSpaceAndComments(i);
                output += source.slice(i, afterDo);
                i = afterDo;

                if (source[i] === '{') {
                    output += `{ ${guard}`;
                    i++;
                } else {
                    const stmtEnd = findStatementEnd(i);
                    const stmt = source.slice(i, stmtEnd);
                    output += `{ ${guard}${transformLoops(stmt)} }`;
                    i = stmtEnd;
                }
                continue;
            }

            // 5. while or for loops
            if (matchesKeyword(i, 'while') || matchesKeyword(i, 'for')) {
                const isWhile = matchesKeyword(i, 'while');
                const word = isWhile ? 'while' : 'for';

                if (isWhile && doWhileDepth > 0) {
                    doWhileDepth--;
                    output += 'while';
                    i += 5;
                    continue;
                }

                loopCount++;
                output += word;
                i += word.length;

                const openParen = source.indexOf('(', i);
                if (openParen === -1) {
                    continue;
                }

                output += source.slice(i, openParen + 1);
                const closeParen = findMatchingParen(openParen);
                output += source.slice(openParen + 1, closeParen + 1);
                i = closeParen + 1;

                const afterParen = skipSpaceAndComments(i);
                output += source.slice(i, afterParen);
                i = afterParen;

                if (source[i] === '{') {
                    output += `{ ${guard}`;
                    i++;
                } else if (source[i] === ';') {
                    output += `{ ${guard}}`;
                    i++;
                } else {
                    const stmtEnd = findStatementEnd(i);
                    const stmt = source.slice(i, stmtEnd);
                    output += `{ ${guard}${transformLoops(stmt)} }`;
                    i = stmtEnd;
                }
                continue;
            }

            output += ch;
            i++;
        }

        return output;
    }

    const transformed = transformLoops(code);

    if (loopCount === 0) {
        return code;
    }

    let result = `let __loopCount = 0;\n${transformed}`;
    result = result.replace(
        /\b(async\s+)?function\s+(update|start)\s*\(([^)]*)\)\s*\{/g,
        `$1function $2($3) { __loopCount = 0; `
    );

    return result;
}

/**
 * Automatically transforms player code so they can call sleep(ms) without writing async/await.
 * Converts all function declarations to async functions and prefixes calls to sleep() and
 * user-defined helper functions with await.
 */
export function injectAsyncSleep(code: string): string {
    // 1. Find all declared function names (ignoring comments)
    const cleanCode = code
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const userFnNames = new Set<string>();
    const fnDeclRegex = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = fnDeclRegex.exec(cleanCode)) !== null) {
        userFnNames.add(match[1]);
    }

    // 2. Convert all standard function declarations to async function
    let transformed = code.replace(/\b(?<!async\s+)function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, 'async function $1(');

    // 3. Prefix sleep(...) calls with await
    transformed = transformed.replace(/(?<!await\s+)\bsleep\s*\(/g, 'await sleep(');

    // 4. Prefix calls to user-defined functions with await
    for (const fnName of userFnNames) {
        const escapedName = fnName.replace(/\$/g, '\\$');
        const callRegex = new RegExp(`(?<!\\b(?:function|await)\\s+)(?<!\\.)\\b${escapedName}\\s*\\(`, 'g');
        transformed = transformed.replace(callRegex, `await ${fnName}(`);
    }

    return transformed;
}

/**
 * Automatically transforms single-argument `track('myVar')` or `track(myVar)` calls
 * into `track('myVar', () => myVar)`. This captures the variable in a closure so it
 * dynamically reflects changes during update() ticks without needing repeated track() calls.
 */
export function injectTrackGetters(code: string): string {
    return code.replace(/\btrack\s*\(\s*(['"]?)([a-zA-Z_$][a-zA-Z0-9_$]*)\1\s*\)/g, (_, _quote, varName) => {
        return `track('${varName}', () => ${varName})`;
    });
}

/**
 * Compiles player code inside a sandboxed factory function with shadowed globals.
 * Extracts both `start` (optional) and `update` functions.
 *
 * HOW THE SANDBOX WORKS:
 * 1. Global browser objects (window, document, fetch, eval, Function, globalThis, self)
 *    are declared as formal parameters and passed as `undefined`.
 * 2. An inner IIFE enforces `"use strict";` so undeclared variables (e.g. `x = 5;`)
 *    throw a ReferenceError instead of polluting the global window object.
 * 3. By keeping `"use strict";` inside the inner IIFE, having `eval` in the outer
 *    parameter list is 100% valid ECMAScript and does not cause a SyntaxError.
 */
export function compilePlayerCode(
    rawCode: string,
    api: RobotAPI,
    sleepFn: (ms: number) => Promise<void>
): CompiledScript {
    // 1. Auto-async sleep transformation for update() and start()
    let preparedCode = injectAsyncSleep(rawCode);

    // 2. Loop counter protection with single top-level __loopCount
    preparedCode = injectLoopProtection(preparedCode);

    // 3. Track getters transformation
    preparedCode = injectTrackGetters(preparedCode);

    // 4. Construct sandboxed function factory
    const createPlayerScope = new Function(
        'moveRight',
        'moveLeft',
        'stop',
        'track',
        'sleep',
        'window',
        'document',
        'fetch',
        'eval',
        'Function',
        'globalThis',
        'self',
        `
        return (function() {
            "use strict";
            ${preparedCode}
            return {
                start: typeof start === 'function' ? start : null,
                update: typeof update === 'function' ? update : null
            };
        })();
        `
    );

    // Execute the factory once to establish player closure scope
    const script: CompiledScript = createPlayerScope(
        api.moveRight,
        api.moveLeft,
        api.stop,
        api.track,
        sleepFn,
        undefined, // shadows window
        undefined, // shadows document
        undefined, // shadows fetch
        undefined, // shadows eval
        undefined, // shadows Function
        undefined, // shadows globalThis
        undefined  // shadows self
    );

    if (!script.update && !script.start) {
        throw new Error("No update() or start() function found. Please define 'function update() { ... }' or 'function start() { ... }'.");
    }

    return script;
}

/**
 * Manages player code lifecycle: compilation, sequential start() execution,
 * fixed tick loop (100ms), and error handling.
 */
export class CodeRunner {
    private scene: Phaser.Scene;
    private api: RobotAPI;
    private onPostTick?: () => void;
    private isUpdating: boolean = false;
    private currentRunId: number = 0;
    private playerUpdateFn: (() => Promise<void> | void) | null = null;
    private codeTimer: Phaser.Time.TimerEvent | null = null;
    private readonly tickIntervalMs: number = 100;

    constructor(scene: Phaser.Scene, api: RobotAPI, onPostTick?: () => void) {
        this.scene = scene;
        this.api = api;
        this.onPostTick = onPostTick;
    }

    /**
     * Pauses player execution for `ms` milliseconds using Phaser's clock timer.
     * If the execution was stopped or restarted while sleeping (runId mismatch),
     * rejects with __EXECUTION_ABORTED__ to cancel remaining operations.
     */
    private sleep(ms: number, runId: number): Promise<void> {
        // Immediately refresh tracked variables so values set right before sleep() are visible during the pause
        this.onPostTick?.();

        const safeMs = Math.max(0, Number(ms) || 0);

        return new Promise<void>((resolve, reject) => {
            this.scene.time.delayedCall(safeMs, () => {
                // If runId changed while waiting (clicked Stop/Run), abort immediately
                if (this.currentRunId !== runId) {
                    reject(new Error('__EXECUTION_ABORTED__'));
                    return;
                }

                // Keep HUD fresh when sleep finishes
                this.onPostTick?.();
                resolve();
            });
        });
    }

    /**
     * Approach 1: Sequential Blocking Execution
     * 1. Compiles script.
     * 2. If start() exists, awaits it to completion (supporting sleep).
     * 3. Once start() completes, starts the 100ms update() tick timer.
     */
    async run(rawCode: string): Promise<void> {
        this.stop();

        const runId = ++this.currentRunId;

        // Immediately notify React UI that execution has started
        EventBus.emit('code-started');

        try {
            const script = compilePlayerCode(
                rawCode,
                this.api,
                (ms: number) => this.sleep(ms, runId)
            );

            this.playerUpdateFn = script.update;

            // Execute initial evaluation for tracked variables
            this.onPostTick?.();

            // Run start() if defined, blocking until it finishes
            if (script.start) {
                this.isUpdating = true;
                try {
                    await script.start();
                    this.onPostTick?.();
                } finally {
                    this.isUpdating = false;
                }
            }

            // Check if player clicked Stop/Reset while start() was running or sleeping
            if (this.currentRunId !== runId) {
                return;
            }

            // If an update() function was provided, start the recurring tick loop
            if (this.playerUpdateFn) {
                this.codeTimer = this.scene.time.addEvent({
                    delay: this.tickIntervalMs,
                    callback: this.executeTick,
                    callbackScope: this,
                    loop: true,
                });
            }
        } catch (err: any) {
            // Silently ignore aborted execution caused by clicking stop while sleeping
            if (err?.message === '__EXECUTION_ABORTED__') {
                return;
            }
            this.stop();
            EventBus.emit('code-error', err?.message || String(err));
        }
    }

    /**
     * Executes on every timer tick (every 100ms).
     * Prevents overlapping ticks: if a previous update() is still awaiting sleep(),
     * the new tick is safely skipped until the previous update() resolves.
     */
    private async executeTick(): Promise<void> {
        if (!this.playerUpdateFn || this.isUpdating) return;

        this.isUpdating = true;
        try {
            await this.playerUpdateFn();
            this.onPostTick?.();
        } catch (err: any) {
            // Silently ignore aborted promises caused by stopping/restarting while sleeping
            if (err?.message === '__EXECUTION_ABORTED__') {
                return;
            }
            this.stop();
            EventBus.emit('code-error', `Runtime error in update(): ${err?.message || String(err)}`);
        } finally {
            this.isUpdating = false;
        }
    }

    stop(): void {
        // Increment runId to invalidate any pending sleep() promises from this session
        this.currentRunId++;
        this.isUpdating = false;

        if (this.codeTimer) {
            this.codeTimer.remove();
            this.codeTimer = null;
        }
        this.playerUpdateFn = null;
    }

    isRunning(): boolean {
        return this.playerUpdateFn !== null || this.isUpdating;
    }
}
