(function (global) {
	'use strict';

	var MIN_PX = 8;
	var FIT_SLACK = 2;
	/** body uses --jeopardy-text-shadow (4px 4px); scroll metrics ignore ink overflow */
	var TEXT_SHADOW_PAD_X = 4;
	var TEXT_SHADOW_PAD_Y = 4;

	var PLAYER_REVEALED_MAX_PX = 132;
	var PLAYER_REVEALED_MIN_PX = 12;

	var boardResizeObserver = null;

	function effectiveContainerBox(container) {
		var w = container.clientWidth - TEXT_SHADOW_PAD_X;
		var h = container.clientHeight - TEXT_SHADOW_PAD_Y;
		return { w: w, h: h };
	}

	/**
	 * Inner is inline-block + max-width:100% (see style.css) so scrollWidth/Height
	 * track the text box — short titles can grow until they hit width or height.
	 */
	function fits(el, container) {
		var box = effectiveContainerBox(container);
		if (box.w <= 4 || box.h <= 4) {
			return false;
		}
		return (
			el.scrollHeight <= box.h + FIT_SLACK &&
			el.scrollWidth <= box.w + FIT_SLACK
		);
	}

	/**
	 * Upper bound for binary search only — not the final size.
	 * Must be large so short titles can grow until they hit an edge; fits() picks the real max.
	 */
	function categoryTitleFontUpperBound(container) {
		var box = effectiveContainerBox(container);
		var w = box.w;
		var h = box.h;
		if (w <= 4 || h <= 4) {
			return MIN_PX;
		}
		return Math.min(
			220,
			Math.max(
				MIN_PX + 1,
				Math.floor(h * 2.8),
				Math.floor(w * 0.95)
			)
		);
	}

	function fitElementInContainer(inner, container, minPx, maxPx) {
		var low = minPx;
		var high = maxPx;
		var best = minPx;
		inner.style.fontSize = maxPx + 'px';
		while (low <= high) {
			var mid = (low + high) >> 1;
			inner.style.fontSize = mid + 'px';
			if (fits(inner, container)) {
				best = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		inner.style.fontSize = best + 'px';
		return best;
	}

	function escapeCategoryHtmlFragment(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	/**
	 * Try natural wrapping plus one explicit <br> after 1st word, 2nd word, …
	 * so titles like "GEOGRAPHIC NAME GAME" can become two lines and use a larger font.
	 */
	function categoryTitleHtmlCandidates(plain) {
		var t = String(plain || '').trim();
		var words = t.split(/\s+/).filter(function (w) {
			return w.length;
		});
		var candidates = [];
		candidates.push(escapeCategoryHtmlFragment(t));
		if (words.length < 2) {
			return candidates;
		}
		var wi;
		for (wi = 1; wi < words.length; wi++) {
			var line1 = escapeCategoryHtmlFragment(words.slice(0, wi).join(' '));
			var line2 = escapeCategoryHtmlFragment(words.slice(wi).join(' '));
			candidates.push(line1 + '<br />' + line2);
		}
		return candidates;
	}

	function readCategoryPlainText(inner) {
		try {
			var attr = inner.getAttribute('data-category-plain');
			if (attr) {
				return decodeURIComponent(attr);
			}
		} catch (e1) {}
		return (inner.textContent || '').trim();
	}

	function fitOne(inner, container) {
		var maxPx = categoryTitleFontUpperBound(container);
		var plain = readCategoryPlainText(inner);
		var cands = categoryTitleHtmlCandidates(plain);
		var bestSize = -1;
		var bestHtml = cands[0];
		var ci;
		for (ci = 0; ci < cands.length; ci++) {
			inner.innerHTML = cands[ci];
			var sz = fitElementInContainer(inner, container, MIN_PX, maxPx);
			if (sz > bestSize) {
				bestSize = sz;
				bestHtml = cands[ci];
			}
		}
		inner.innerHTML = bestHtml;
		fitElementInContainer(inner, container, MIN_PX, maxPx);
	}

	function fitJeopardyCategoryHeaders(root) {
		var base = root;
		if (!base || !base.querySelector) {
			var gb = document.getElementById('game_board');
			base = gb && gb.parentElement ? gb.parentElement : document;
		}
		var inners = base.querySelectorAll(
			'#game_board tr:first-child th .category-header-text__inner'
		);
		var i;
		var anyTooSmall = false;
		for (i = 0; i < inners.length; i++) {
			var inner = inners[i];
			var container = inner.closest('.category-header-text');
			if (!container) {
				continue;
			}
			if (container.clientHeight < 8 || container.clientWidth < 8) {
				anyTooSmall = true;
				continue;
			}
			fitOne(inner, container);
		}
		if (anyTooSmall && inners.length) {
			return false;
		}
		return true;
	}

	function scheduleJeopardyCategoryHeaderFit(root) {
		function run() {
			var ok = fitJeopardyCategoryHeaders(root);
			if (ok === false) {
				setTimeout(function () {
					fitJeopardyCategoryHeaders(root);
				}, 120);
			}
		}
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				run();
				setTimeout(run, 50);
				setTimeout(run, 350);
			});
		});
	}

	function ensureBoardResizeObserver(root) {
		var el =
			root && root.nodeType === 1
				? root
				: document.getElementById('game_board_container');
		if (!el || typeof ResizeObserver === 'undefined') {
			return;
		}
		if (boardResizeObserver) {
			boardResizeObserver.disconnect();
		}
		boardResizeObserver = new ResizeObserver(function () {
			fitJeopardyCategoryHeaders(el);
		});
		boardResizeObserver.observe(el);
	}

	function fitPlayerQuestionRevealed() {
		var heading = document.getElementById('question_revealed');
		var container = document.querySelector('.player_question_revealed_bounds');
		if (!heading || !container) {
			return;
		}
		if (global.getComputedStyle(heading).display === 'none') {
			return;
		}
		var text = (heading.textContent || '').trim();
		if (!text) {
			return;
		}
		if (!container.clientWidth || !container.clientHeight) {
			return;
		}
		fitElementInContainer(heading, container, PLAYER_REVEALED_MIN_PX, PLAYER_REVEALED_MAX_PX);
	}

	function schedulePlayerQuestionRevealedFit() {
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				fitPlayerQuestionRevealed();
			});
		});
	}

	var resizeTimer;
	function onResize() {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(function () {
			fitPlayerQuestionRevealed();
			if (document.getElementById('game_board')) {
				fitJeopardyCategoryHeaders();
			}
		}, 100);
	}

	if (typeof global.addEventListener === 'function') {
		global.addEventListener('resize', onResize);
	}

	global.fitJeopardyCategoryHeaders = fitJeopardyCategoryHeaders;
	global.scheduleJeopardyCategoryHeaderFit = function (root) {
		scheduleJeopardyCategoryHeaderFit(root);
		ensureBoardResizeObserver(root);
	};
	global.fitPlayerQuestionRevealed = fitPlayerQuestionRevealed;
	global.schedulePlayerQuestionRevealedFit = schedulePlayerQuestionRevealedFit;
})(typeof window !== 'undefined' ? window : this);
