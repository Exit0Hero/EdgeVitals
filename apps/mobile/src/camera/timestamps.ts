/**
 * Camera frame timestamps come in platform-specific units (nanoseconds on
 * Android, seconds or milliseconds elsewhere). The measurement pipeline needs
 * milliseconds, so the unit is inferred from the first frame interval: real
 * cameras run at 5-120 fps, i.e. 8-200 ms between frames.
 */
export function createTimestampNormalizer() {
  let first: number | null = null;
  let scale: number | null = null;
  return (raw: number): number | null => {
    if (first === null) {
      first = raw;
      return null;
    }
    if (scale === null) {
      const d = raw - first;
      if (d <= 0) return null;
      // Choose the unit that puts the first interval closest to 33 ms.
      const candidates = [1, 1e3, 1e-3, 1e-6];
      scale = candidates.reduce((best, s) =>
        Math.abs(Math.log((d * s) / 33)) < Math.abs(Math.log((d * best) / 33)) ? s : best,
      );
    }
    return (raw - first) * scale;
  };
}
