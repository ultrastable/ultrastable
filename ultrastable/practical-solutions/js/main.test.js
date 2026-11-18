import { jest } from '@jest/globals';
import '../css/style.css';

test('stylesheet is imported', () => {
  expect(document.styleSheets.length).toBeGreaterThan(0);
});