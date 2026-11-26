// Loads the MediaPipe vision module as a same-origin ES module and hands it to
// the app. Using a <script type="module"> keeps the app compatible with a
// Content-Security-Policy that forbids eval (no 'unsafe-eval').
import * as vision from './vision_bundle.mjs';

window.__edgevitalsVision = vision;
window.dispatchEvent(new Event('edgevitals-vision-ready'));
