/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './motion.css';

//#region Duration Constants

/**
 * Duration in milliseconds for panel open (entrance) animations.
 * Per Fluent 2 Enter/Exit pattern - entrance should feel smooth but not sluggish.
 */
export const PANEL_OPEN_DURATION = 200;

/**
 * Duration in milliseconds for panel close (exit) animations.
 * Exits are faster than entrances - feels snappy and responsive.
 */
export const PANEL_CLOSE_DURATION = 75;

/**
 * Duration in milliseconds for quick input open (entrance) animations.
 */
export const QUICK_INPUT_OPEN_DURATION = 125;

/**
 * Duration in milliseconds for quick input close (exit) animations.
 */
export const QUICK_INPUT_CLOSE_DURATION = 75;

//#endregion

//#region Easing Curves

/**
 * Fluent 2 ease-out curve - default for entrances and expansions.
 * Starts fast and decelerates to a stop.
 */
export const EASE_OUT = 'cubic-bezier(0.1, 0.9, 0.2, 1)';

/**
 * Fluent 2 ease-in curve - for exits and collapses.
 * Starts slow and accelerates out.
 */
export const EASE_IN = 'cubic-bezier(0.9, 0.1, 1, 0.2)';

//#endregion

//#region Cubic Bezier Evaluation

/**
 * Parses a CSS `cubic-bezier(x1, y1, x2, y2)` string into its four control
 * point values. Returns `[0, 0, 1, 1]` (linear) on parse failure.
 */
export function parseCubicBezier(css: string): [number, number, number, number] {
	const match = css.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
	if (!match) {
		return [0, 0, 1, 1];
	}
	return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4])];
}

/**
 * Evaluates a cubic bezier curve at time `t` (0-1).
 *
 * Given control points `(x1, y1)` and `(x2, y2)` (the CSS `cubic-bezier`
 * parameters), this finds the bezier parameter `u` such that `Bx(u) = t`
 * using Newton's method, then returns `By(u)`.
 */
export function solveCubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
	if (t <= 0) {
		return 0;
	}
	if (t >= 1) {
		return 1;
	}

	// Newton's method to find u where Bx(u) = t
	let u = t; // initial guess
	for (let i = 0; i < 8; i++) {
		const currentX = bezierComponent(u, x1, x2);
		const error = currentX - t;
		if (Math.abs(error) < 1e-6) {
			break;
		}
		const dx = bezierComponentDerivative(u, x1, x2);
		if (Math.abs(dx) < 1e-6) {
			break;
		}
		u -= error / dx;
	}

	u = Math.max(0, Math.min(1, u));
	return bezierComponent(u, y1, y2);
}

/** Evaluates one component of a cubic bezier: B(u) with control points p1, p2, endpoints 0 and 1. */
function bezierComponent(u: number, p1: number, p2: number): number {
	// B(u) = 3(1-u)^2*u*p1 + 3(1-u)*u^2*p2 + u^3
	const oneMinusU = 1 - u;
	return 3 * oneMinusU * oneMinusU * u * p1 + 3 * oneMinusU * u * u * p2 + u * u * u;
}

/** First derivative of a bezier component: B'(u). */
function bezierComponentDerivative(u: number, p1: number, p2: number): number {
	// B'(u) = 3(1-u)^2*p1 + 6(1-u)*u*(p2-p1) + 3*u^2*(1-p2)
	const oneMinusU = 1 - u;
	return 3 * oneMinusU * oneMinusU * p1 + 6 * oneMinusU * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

//#endregion

//#region Utility Functions

/**
 * Checks whether motion is reduced by looking for the `monaco-reduce-motion`
 * class on an ancestor element. This integrates with VS Code's existing
 * accessibility infrastructure in {@link AccessibilityService}.
 */
export function isMotionReduced(element: HTMLElement): boolean {
	return element.closest('.monaco-reduce-motion') !== null;
}

//#endregion
