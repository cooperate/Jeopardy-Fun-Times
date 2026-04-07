/**
 * Minimal modal dialogs (alert / confirm / prompt) — vanilla JS, no SweetAlert.
 * Global: window.SimpleModal
 */
(function (global) {
  var overlay = null;
  var timerId = null;
  var keyHandler = null;

  function clearTimer() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function removeKeyHandler() {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  }

  function hide() {
    clearTimer();
    removeKeyHandler();
    if (!overlay) return;
    overlay.classList.add('simple-modal-overlay--hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('simple-modal-open');
  }

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'simple_modal_overlay';
    overlay.className = 'simple-modal-overlay simple-modal-overlay--hidden';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="simple-modal" role="document">' +
      '<h2 class="simple-modal__title"></h2>' +
      '<p class="simple-modal__text"></p>' +
      '<input type="text" class="simple-modal__input" autocomplete="off" autocapitalize="characters" />' +
      '<p class="simple-modal__error simple-modal__error--hidden"></p>' +
      '<div class="simple-modal__actions"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        e.preventDefault();
      }
    });
  }

  function getParts() {
    ensureDom();
    var box = overlay.querySelector('.simple-modal');
    return {
      box: box,
      title: overlay.querySelector('.simple-modal__title'),
      text: overlay.querySelector('.simple-modal__text'),
      input: overlay.querySelector('.simple-modal__input'),
      error: overlay.querySelector('.simple-modal__error'),
      actions: overlay.querySelector('.simple-modal__actions'),
    };
  }

  function setVariant(box, variant) {
    box.classList.remove('simple-modal--success', 'simple-modal--error');
    if (variant === 'success') box.classList.add('simple-modal--success');
    if (variant === 'error') box.classList.add('simple-modal--error');
  }

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.text]
   * @param {number} [opts.timer] — ms; if set, auto-close (no buttons)
   * @param {'info'|'success'|'error'} [opts.type]
   */
  function alert(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var p = getParts();
      clearTimer();
      removeKeyHandler();
      setVariant(p.box, opts.type === 'success' ? 'success' : opts.type === 'error' ? 'error' : null);

      p.title.textContent = opts.title || '';
      p.text.textContent = opts.text || '';
      p.input.style.display = 'none';
      p.error.classList.add('simple-modal__error--hidden');
      p.error.textContent = '';
      p.actions.innerHTML = '';

      var ms = opts.timer != null ? Number(opts.timer) : 0;
      if (ms > 0) {
        overlay.classList.remove('simple-modal-overlay--hidden');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('simple-modal-open');
        timerId = setTimeout(function () {
          hide();
          resolve();
        }, ms);
        keyHandler = function (ev) {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            hide();
            resolve();
          }
        };
        document.addEventListener('keydown', keyHandler);
        return;
      }

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'simple-modal__btn simple-modal__btn--primary';
      ok.textContent = opts.confirmText || 'OK';
      ok.addEventListener('click', function () {
        hide();
        resolve();
      });
      p.actions.appendChild(ok);

      overlay.classList.remove('simple-modal-overlay--hidden');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('simple-modal-open');
      ok.focus();

      keyHandler = function (ev) {
        if (ev.key === 'Escape' || ev.key === 'Enter') {
          ev.preventDefault();
          ok.click();
        }
      };
      document.addEventListener('keydown', keyHandler);
    });
  }

  /**
   * @param {object} opts
   * @returns {Promise<boolean>}
   */
  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var p = getParts();
      clearTimer();
      removeKeyHandler();
      setVariant(p.box, null);

      p.title.textContent = opts.title || '';
      p.text.textContent = opts.text || '';
      p.input.style.display = 'none';
      p.error.classList.add('simple-modal__error--hidden');
      p.actions.innerHTML = '';

      function finish(val) {
        hide();
        resolve(val);
      }

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'simple-modal__btn simple-modal__btn--secondary';
      cancel.textContent = opts.cancelText || 'Cancel';
      cancel.addEventListener('click', function () {
        finish(false);
      });

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'simple-modal__btn simple-modal__btn--primary';
      ok.textContent = opts.confirmText || 'OK';
      ok.addEventListener('click', function () {
        finish(true);
      });

      p.actions.appendChild(cancel);
      p.actions.appendChild(ok);

      overlay.classList.remove('simple-modal-overlay--hidden');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('simple-modal-open');
      ok.focus();

      keyHandler = function (ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(false);
        }
      };
      document.addEventListener('keydown', keyHandler);
    });
  }

  /**
   * @param {object} opts
   * @param {function(string): string|null|undefined} [opts.validate] — return error message string if invalid
   * @returns {Promise<string|null>} value or null if cancelled
   */
  function prompt(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var p = getParts();
      clearTimer();
      removeKeyHandler();
      setVariant(p.box, null);

      p.title.textContent = opts.title || '';
      p.text.textContent = opts.text || '';
      p.input.style.display = 'block';
      p.input.value = opts.defaultValue || '';
      p.input.placeholder = opts.placeholder || '';
      p.error.classList.add('simple-modal__error--hidden');
      p.error.textContent = '';
      p.actions.innerHTML = '';

      function finish(val) {
        hide();
        resolve(val);
      }

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'simple-modal__btn simple-modal__btn--secondary';
      cancel.textContent = opts.cancelText || 'Cancel';
      cancel.addEventListener('click', function () {
        finish(null);
      });

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'simple-modal__btn simple-modal__btn--primary';
      ok.textContent = opts.confirmText || 'OK';
      ok.addEventListener('click', function () {
        var v = p.input.value;
        if (opts.validate) {
          var err = opts.validate(v);
          if (err) {
            p.error.textContent = err;
            p.error.classList.remove('simple-modal__error--hidden');
            return;
          }
        }
        finish(v);
      });

      p.actions.appendChild(cancel);
      p.actions.appendChild(ok);

      overlay.classList.remove('simple-modal-overlay--hidden');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('simple-modal-open');

      setTimeout(function () {
        p.input.focus();
        p.input.select();
      }, 50);

      keyHandler = function (ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(null);
        }
      };
      document.addEventListener('keydown', keyHandler);

      p.input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          ok.click();
        }
      });
    });
  }

  global.SimpleModal = {
    alert: alert,
    confirm: confirm,
    prompt: prompt,
    close: hide,
  };
})(typeof window !== 'undefined' ? window : this);
