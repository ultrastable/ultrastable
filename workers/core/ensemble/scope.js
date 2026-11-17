// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Status of every piece is kept in core/ensemble/README.md.
// Where an agent may write: a pure, dependency-free allow/deny path guard. The models an ensemble governs cannot edit the files that govern them.
const glob = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
export const makeScope = ({ scope, deny }) => p => !(p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) && !p.split('/').includes('..') && scope.some(g => glob(g).test(p)) && !deny.some(g => glob(g).test(p));
