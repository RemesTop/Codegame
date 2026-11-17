import { test, expect, vi } from 'vitest';

const robot = {
  setVelocityX: vi.fn(),
};

const api = {
  moveRight: () => robot.setVelocityX(100),
  moveLeft: () => robot.setVelocityX(-100),
  stop: () => robot.setVelocityX(0),
};

test('moveRight should move the robot to the right', () => {
  api.moveRight();

  expect(robot.setVelocityX).toHaveBeenCalledWith(100);
});

test('moveLeft should move the robot to the left', () => {
  api.moveLeft();

  expect(robot.setVelocityX).toHaveBeenCalledWith(-100);
});

test('stop should stop the robot', () => {
  api.stop();

  expect(robot.setVelocityX).toHaveBeenCalledWith(0);
});
