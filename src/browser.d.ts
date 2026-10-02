/**
 * Platform APIs TypeScript's DOM library does not declare yet.
 *
 * Both are real, shipped browser features that lib.dom.d.ts has not caught up with.
 * Declaring them here removes the last two `as any` casts in the source and, more
 * usefully, means a typo in a field name is an error rather than silence.
 */

/**
 * Chrome/Edge/Android barcode scanning. Absent on Safari and Firefox, so it is reachable only
 * as `window.BarcodeDetector`, which is optional: using it without feature-detecting does
 * not compile. A global class here let `new BarcodeDetector()` type-check anywhere.
 */
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

interface Window {
  BarcodeDetector?: BarcodeDetectorConstructor;
  /** Safari still exposes the prefixed constructor. */
  webkitAudioContext?: typeof AudioContext;
}
