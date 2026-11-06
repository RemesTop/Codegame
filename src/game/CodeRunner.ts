import { EventBus } from './EventBus';

export interface RobotAPI {
    moveRight: () => void;
    moveLeft: () => void;
    stop: () => void;
    track: (label: string, valueOrGetter?: any) => void;
}

/**
 * Injects infinite loop protection into while, for, and do...while loops.
 * 1. Adds 'if (x > 10000) break;' into loops so they don't crash the browser
 */
export function injectLoopProtection(code: string): string {
    let loopCount = 0;
    let output = '';
    let i = 0;
    const n = code.length;
    let doWhileDepth = 0;

    function isIdent(ch: string): boolean {
        return /[a-zA-Z0-9_$]/.test(ch);
    }

    function skipSpaceAndComments(pos: number): number {
        while (pos < n) {
            const ch = code[pos];
            if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
                pos++;
            } else if (ch === '/' && code[pos + 1] === '/') {
                pos += 2;
                while (pos < n && code[pos] !== '\n') pos++;
            } else if (ch === '/' && code[pos + 1] === '*') {
                pos += 2;
                while (pos < n && !(code[pos] === '*' && code[pos + 1] === '/')) pos++;
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
            const ch = code[p];
            if (ch === '"' || ch === "'" || ch === '`') {
                const quote = ch;
                p++;
                while (p < n && code[p] !== quote) {
                    if (code[p] === '\\') p++;
                    p++;
                }
                p++;
            } else if (ch === '/' && code[p + 1] === '/') {
                p += 2;
                while (p < n && code[p] !== '\n') p++;
            } else if (ch === '/' && code[p + 1] === '*') {
                p += 2;
                while (p < n && !(code[p] === '*' && code[p + 1] === '/')) p++;
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
            const ch = code[p];
            if (ch === '"' || ch === "'" || ch === '`') {
                const quote = ch;
                p++;
                while (p < n && code[p] !== quote) {
                    if (code[p] === '\\') p++;
                    p++;
                }
                p++;
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
        if (!code.startsWith(word, pos)) return false;
        const prev = pos > 0 ? code[pos - 1] : ' ';
        const next = pos + word.length < n ? code[pos + word.length] : ' ';
        return !isIdent(prev) && !isIdent(next);
    }

    while (i < n) {
        const ch = code[i];

        // 1. Strings
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            output += quote;
            i++;
            while (i < n && code[i] !== quote) {
                if (code[i] === '\\') {
                    output += code[i++];
                }
                if (i < n) output += code[i++];
            }
            if (i < n) output += code[i++];
            continue;
        }

        // 2. Line comment
        if (ch === '/' && code[i + 1] === '/') {
            while (i < n && code[i] !== '\n') {
                output += code[i++];
            }
            continue;
        }

        // 3. Block comment
        if (ch === '/' && code[i + 1] === '*') {
            output += '/*';
            i += 2;
            while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
                output += code[i++];
            }
            if (i < n) {
                output += '*/';
                i += 2;
            }
            continue;
        }

        // 4. do ... while loops
        if (matchesKeyword(i, 'do')) {
            const id = loopCount++;
            doWhileDepth++;
            output += 'do';
            i += 2;

            const afterDo = skipSpaceAndComments(i);
            output += code.slice(i, afterDo);
            i = afterDo;

            if (code[i] === '{') {
                output += `{ if (++__loopCount_${id} > 10000) throw new Error("Infinite loop detected: exceeded 10,000 iterations in a single tick"); `;
                i++;
            } else {
                const stmtEnd = findStatementEnd(i);
                const stmt = code.slice(i, stmtEnd);
                output += `{ if (++__loopCount_${id} > 10000) throw new Error("Infinite loop detected: exceeded 10,000 iterations in a single tick"); ${stmt} }`;
                i = stmtEnd;
            }
            continue;
        }

        // 5. while or for loops
        if (matchesKeyword(i, 'while') || matchesKeyword(i, 'for')) {
            const isWhile = matchesKeyword(i, 'while');
            const word = isWhile ? 'while' : 'for';

            // Check if this while is the closing condition of an active do...while
            if (isWhile && doWhileDepth > 0) {
                doWhileDepth--;
                output += 'while';
                i += 5;
                continue;
            }

            const id = loopCount++;
            output += word;
            i += word.length;

            const openParen = code.indexOf('(', i);
            if (openParen === -1) {
                continue;
            }

            output += code.slice(i, openParen + 1);
            const closeParen = findMatchingParen(openParen);
            output += code.slice(openParen + 1, closeParen + 1);
            i = closeParen + 1;

            const afterParen = skipSpaceAndComments(i);
            output += code.slice(i, afterParen);
            i = afterParen;

            if (code[i] === '{') {
                output += `{ if (++__loopCount_${id} > 10000) throw new Error("Infinite loop detected: exceeded 10,000 iterations in a single tick"); `;
                i++;
            } else if (code[i] === ';') {
                output += `{ if (++__loopCount_${id} > 10000) throw new Error("Infinite loop detected: exceeded 10,000 iterations in a single tick"); }`;
                i++;
            } else {
                const stmtEnd = findStatementEnd(i);
                const stmt = code.slice(i, stmtEnd);
                output += `{ if (++__loopCount_${id} > 10000) throw new Error("Infinite loop detected: exceeded 10,000 iterations in a single tick"); ${stmt} }`;
                i = stmtEnd;
            }
            continue;
        }

        output += ch;
        i++;
    }

    if (loopCount === 0) {
        return code;
    }

    const declarations = Array.from({ length: loopCount }, (_, k) => `let __loopCount_${k} = 0;`).join(' ');
    const resets = Array.from({ length: loopCount }, (_, k) => `__loopCount_${k} = 0;`).join(' ');

    let result = `${declarations}\n${output}`;

    result = result.replace(
        /\bfunction\s+update\s*\(([^)]*)\)\s*\{/g,
        `function update($1) { ${resets} `
    );

    return result;
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
 *
 * HOW THE SANDBOX WORKS:
 * 1. Global browser objects (window, document, fetch, eval, Function, globalThis, self)
 *    are declared as formal parameters and passed as `undefined`.
 * 2. An inner IIFE enforces `"use strict";` so undeclared variables (e.g. `x = 5;`)
 *    throw a ReferenceError instead of polluting the global window object.
 * 3. By keeping `"use strict";` inside the inner IIFE, having `eval` in the outer
 *    parameter list is 100% valid ECMAScript and does not cause a SyntaxError.
 */
export function compilePlayerCode(rawCode: string, api: RobotAPI): () => void {
    // 1. Inject loop counter protection
    let preparedCode = injectLoopProtection(rawCode);

    // 2. Transform track(var) into track('var', () => var)
    preparedCode = injectTrackGetters(preparedCode);

    // 3. Construct sandboxed function factory
    const createPlayerScope = new Function(
        'moveRight',
        'moveLeft',
        'stop',
        'track',
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
            return typeof update === 'function' ? update : null;
        })();
        `
    );

    // Execute the factory once to establish player closure scope
    // Shadowed objects cannot be used in the player code
    const updateFn = createPlayerScope(
        api.moveRight,
        api.moveLeft,
        api.stop,
        api.track,
        undefined, // shadows window
        undefined, // shadows document
        undefined, // shadows fetch
        undefined, // shadows eval
        undefined, // shadows Function
        undefined, // shadows globalThis
        undefined  // shadows self
    );

    if (!updateFn) {
        throw new Error("No update() function found. Please define 'function update() { ... }'.");
    }

    return updateFn;
}

/**
 * Manages player code lifecycle: compilation, fixed tick loop (100ms), and error handling.
 */
export class CodeRunner {
    private scene: Phaser.Scene;
    private api: RobotAPI;
    private onPostTick?: () => void;
    private playerUpdateFn: (() => void) | null = null;
    private codeTimer: Phaser.Time.TimerEvent | null = null;
    private readonly tickIntervalMs: number = 100;

    constructor(scene: Phaser.Scene, api: RobotAPI, onPostTick?: () => void) {
        this.scene = scene;
        this.api = api;
        this.onPostTick = onPostTick;
    }

    run(rawCode: string): void {
        this.stop();

        try {
            this.playerUpdateFn = compilePlayerCode(rawCode, this.api);

            // Execute initial evaluation for tracked variables
            this.onPostTick?.();

            // Start fixed tick loop
            this.codeTimer = this.scene.time.addEvent({
                delay: this.tickIntervalMs,
                callback: this.executeTick,
                callbackScope: this,
                loop: true,
            });

            EventBus.emit('code-started');
        } catch (err: any) {
            this.stop();
            EventBus.emit('code-error', err.message || String(err));
        }
    }

    private executeTick(): void {
        if (!this.playerUpdateFn) return;

        try {
            this.playerUpdateFn();
            this.onPostTick?.();
        } catch (err: any) {
            this.stop();
            EventBus.emit('code-error', `Runtime error in update(): ${err.message || String(err)}`);
        }
    }

    stop(): void {
        if (this.codeTimer) {
            this.codeTimer.remove();
            this.codeTimer = null;
        }
        this.playerUpdateFn = null;
    }

    isRunning(): boolean {
        return this.playerUpdateFn !== null;
    }
}
