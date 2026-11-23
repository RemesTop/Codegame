import { expect, test, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { GameHUD } from '../GameHUD';

test('tracked getters refresh the HUD and reset clears tracked values', () => {
  const trackBg = {
    setStrokeStyle: vi.fn(),
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
  };
  const trackText = {
    width: 80,
    height: 20,
    setOrigin: vi.fn(),
    setDepth: vi.fn(),
    setText: vi.fn(),
  };
  const scene = {
    add: {
      rectangle: vi.fn(() => trackBg),
      text: vi.fn(() => trackText),
    },
  } as unknown as Phaser.Scene;
  const hud = new GameHUD(scene);
  let score = 1;

  hud.registerTrack('score', () => score);
  expect(trackText.setText).toHaveBeenLastCalledWith('score: 1');

  score = 2;
  hud.evaluateTrackedVariables();
  expect(trackText.setText).toHaveBeenLastCalledWith('score: 2');

  hud.reset();
  expect(trackText.setText).toHaveBeenLastCalledWith('');
  expect(trackBg.setVisible).toHaveBeenLastCalledWith(false);
});
