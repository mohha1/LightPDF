/** Normalizes any angle in degrees to 0, 90, 180 or 270. */
export function normalizeAngle(angle: number): number {
  const quarterTurns = Math.round(angle / 90);
  return (((quarterTurns * 90) % 360) + 360) % 360;
}
