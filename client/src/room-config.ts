export const roomConfig = {
  width: 5, depth: 5, height: 2.8, frontZ: -3.2, backZ: 1.8,
  doorWall: 'left' as const, doorWidth: 2.4, doorHeight: 2.25,
  seat: [0, 0, 0] as const,
  workbench: [0, 0, -0.72] as const,
  trash: [0.88, 0, -0.68] as const,
  monitors: { count: 2, radius: 1.8, height: 1.55, stepDegrees: 38 },
};
