/**
 * Platform APIs TypeScript's DOM library does not declare yet.
 *
 * Both are real, shipped browser features that lib.dom.d.ts has not caught up with.
 * Declaring them here removes the last two `as any` casts in the source and, more
 * usefully, means a typo in a field name is an error rather than silence.
 */

/** Chrome/Edge/Android barcode scanning. Absent on Safari and Firefox — always feature-detect. */
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
  static getSupportedFormats(): Promise<string[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
  /** Safari still exposes the prefixed constructor. */
  webkitAudioContext?: typeof AudioContext;
}
