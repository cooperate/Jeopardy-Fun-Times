(function (global) {
	'use strict';

	var MAX_PX = 56;
	var MIN_PX = 11;
	var FIT_SLACK = 2;

	var PLAYER_REVEALED_MAX_PX = 132;
	var PLAYER_REVEALED_MIN_PX = 12;

	function fits(el, container) {
		return (
			el.scrollHeight <= container.clientHeight + FIT_SLACK &&
			el.scrollWidth <= container.clientWidth + FIT_SLACK
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
	}

	function fitOne(inner, container) {
		fitElementInContainer(inner, container, MIN_PX, MAX_PX);
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
		for (i = 0; i < inners.length; i++) {
			var inner = inners[i];
			var container = inner.closest('.category-header-text');
			if (!container) {
				continue;
			}
			inner.style.fontSize = MAX_PX + 'px';
			fitOne(inner, container);
		}
	}

	function scheduleJeopardyCategoryHeaderFit(root) {
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				fitJeopardyCategoryHeaders(root);
			});
		});
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
	global.scheduleJeopardyCategoryHeaderFit = scheduleJeopardyCategoryHeaderFit;
	global.fitPlayerQuestionRevealed = fitPlayerQuestionRevealed;
	global.schedulePlayerQuestionRevealedFit = schedulePlayerQuestionRevealedFit;
})(typeof window !== 'undefined' ? window : this);
