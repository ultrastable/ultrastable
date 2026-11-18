// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { jest } from '@jest/globals';
import '../css/style.css';

test('stylesheet is imported', () => {
  expect(document.styleSheets.length).toBeGreaterThan(0);
});