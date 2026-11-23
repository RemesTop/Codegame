import { expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({
  Events: {
    EventEmitter: class {
      on = vi.fn();
      off = vi.fn();
      emit = vi.fn();
      once = vi.fn();
      removeAllListeners = vi.fn();
    },
  },
}));

import {
  injectAsyncSleep,
  injectLoopProtection,
  injectTrackGetters,
} from '../CodeRunner';

test('injectLoopProtection should throw for an infinite while loop', () => {
  const result = injectLoopProtection(`
    function start() {
      while (true) {}
    }
  `);
  const createStart = new Function(`${result}\nreturn start;`);
  const start = createStart();

  expect(() => start()).toThrow(
    'Infinite loop detected: exceeded 10,000 iterations in a single tick',
  );
});

test('injectLoopProtection should leave code without loops unchanged', () => {
  const rawCode = `
    function start() {
      console.log("No infinite loop")
    }
  `;

  expect(injectLoopProtection(rawCode)).toBe(rawCode);
});

test('injectLoopProtection should protect braceless while loops', () => {
  const result = injectLoopProtection(`
    function update() {
      let count = 0;
      while (count++ < 2)
        moveRight();
    }
  `);

  expect(result).toMatch(/while\s*\(count\+\+\s*<\s*2\)\s*\{/);
  expect(result).toContain('Infinite loop detected');

  const createUpdate = new Function(
    'moveRight',
    `${result}\nreturn update;`,
  );
  const moveRight = vi.fn();
  const update = createUpdate(moveRight);

  update();
  expect(moveRight).toHaveBeenCalledTimes(2);
});

test('injectLoopProtection should preserve a braceless if-else loop body', () => {
  const result = injectLoopProtection(`
    function update() {
      let count = 0;
      while (count < 2)
        if (count++ === 0) moveRight();
        else moveLeft();
    }
  `);
  const createUpdate = new Function(
    'moveRight',
    'moveLeft',
    `${result}\nreturn update;`,
  );
  const moveRight = vi.fn();
  const moveLeft = vi.fn();
  const update = createUpdate(moveRight, moveLeft);

  update();

  expect(moveRight).toHaveBeenCalledTimes(1);
  expect(moveLeft).toHaveBeenCalledTimes(1);
});

test('injectLoopProtection should preserve semicolon-less braceless loop bodies', () => {
  const result = injectLoopProtection(`
    function update() {
      let count = 0;
      while (count++ < 2) moveRight()
    }
  `);
  const createUpdate = new Function(
    'moveRight',
    `${result}\nreturn update;`,
  );
  const moveRight = vi.fn();
  const update = createUpdate(moveRight);

  update();
  expect(moveRight).toHaveBeenCalledTimes(2);
});

test('injectLoopProtection should handle nested condition parentheses', () => {
  const result = injectLoopProtection(`
    function update() {
      for (let i = 0; (i < 2 && (i + 1 <= 2)); i++) {
        moveRight();
      }
    }
  `);
  const createUpdate = new Function(
    'moveRight',
    `${result}\nreturn update;`,
  );
  const moveRight = vi.fn();
  const update = createUpdate(moveRight);

  update();

  expect(result).toContain('if (++__loopCount > 10000)');
  expect(moveRight).toHaveBeenCalledTimes(2);
});

test('injectLoopProtection should ignore loop keywords inside strings and comments', () => {
  const rawCode = `
    function start() {
      const text = "while (true)";
      // for (;;) {}
      /* do {} while (true); */
      moveRight();
    }
  `;

  expect(injectLoopProtection(rawCode)).toBe(rawCode);
});

test('injectLoopProtection should ignore loop keywords inside regex literals', () => {
  const rawCode = `
    function start() {
      const pattern = /for/;
      moveRight();
    }
  `;

  expect(injectLoopProtection(rawCode)).toBe(rawCode);
});

test('injectLoopProtection should protect loops inside template interpolations', () => {
  const result = injectLoopProtection(`
    function update() {
      const value = \`\${(() => {
        let count = 0;
        while (count++ < 10001) {}
        return count;
      })()}\`;
    }
  `);
  const createUpdate = new Function(`${result}\nreturn update;`);
  const update = createUpdate();

  expect(() => update()).toThrow(
    'Infinite loop detected: exceeded 10,000 iterations in a single tick',
  );
});

test('injectLoopProtection should protect do-while loops', () => {
  const result = injectLoopProtection(`
    function update() {
      do
        moveRight();
      while (false);
    }
  `);
  const createUpdate = new Function(
    'moveRight',
    `${result}\nreturn update;`,
  );
  const moveRight = vi.fn();
  const update = createUpdate(moveRight);

  update();

  expect(result).toContain('Infinite loop detected');
  expect(moveRight).toHaveBeenCalledTimes(1);
});

test('injectLoopProtection should throw for an infinite for loop', () => {
  const result = injectLoopProtection(`
    function update() {
      for (;;) {}
    }
  `);
  const createUpdate = new Function(`${result}\nreturn update;`);
  const update = createUpdate();

  expect(() => update()).toThrow(
    'Infinite loop detected: exceeded 10,000 iterations in a single tick',
  );
});

test('injectLoopProtection should throw for an infinite do-while loop', () => {
  const result = injectLoopProtection(`
    function update() {
      do {} while (true);
    }
  `);
  const createUpdate = new Function(`${result}\nreturn update;`);
  const update = createUpdate();

  expect(() => update()).toThrow(
    'Infinite loop detected: exceeded 10,000 iterations in a single tick',
  );
});

test('injectLoopProtection should reset the loop counter on each update', () => {
  const result = injectLoopProtection(`
    function update() {
      for (let i = 0; i < 6000; i++) {}
    }
  `);
  const createUpdate = new Function(`${result}\nreturn update;`);
  const update = createUpdate();

  expect(() => {
    update();
    update();
  }).not.toThrow();
});

test('injectAsyncSleep should make start async and await sleep', () => {
  const result = injectAsyncSleep(`
    function start() {
      sleep(100);
    }
  `);

  expect(result).toContain('async function start()');
  expect(result).toContain('await sleep(100)');
});

test('injectAsyncSleep should await calls to declared helper functions', () => {
  const result = injectAsyncSleep(`
    function start() {
      moveAndWait();
    }
    function moveAndWait() {
      sleep(25);
      moveRight();
    }
  `);

  expect(result).toContain('async function start()');
  expect(result).toContain('await moveAndWait()');
  expect(result).toContain('async function moveAndWait()');
  expect(result).toContain('await sleep(25)');
});

test('injectAsyncSleep should leave comments and strings unchanged', () => {
  const rawCode = `
    function start() {
      // sleep(10);
      const text = "sleep(10)";
      moveRight();
    }
  `;
  const result = injectAsyncSleep(rawCode);

  expect(result).toContain('// sleep(10);');
  expect(result).toContain('"sleep(10)"');
});

test('injectTrackGetters should transform identifier and string labels', () => {
  const resultIdentifier = injectTrackGetters('track(myVar)');
  const resultString = injectTrackGetters("track('myVar')");

  expect(resultIdentifier).toContain("track('myVar', () => myVar)");
  expect(resultString).toContain("track('myVar', () => myVar)");
});

test('injectTrackGetters should leave comments and strings unchanged', () => {
  const rawCode = `
    const text = "track(myVar)";
    // track(myVar)
    /* track('myVar') */
    track(myVar);
  `;
  const result = injectTrackGetters(rawCode);

  expect(result).toContain('"track(myVar)"');
  expect(result).toContain('// track(myVar)');
  expect(result).toContain("/* track('myVar') */");
  expect(result).toContain("track('myVar', () => myVar);");
});
