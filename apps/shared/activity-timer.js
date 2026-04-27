(function () {
  function formatSeconds(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function createActivityTimer(options) {
    const config = {
      targetSeconds: 300,
      idleMessage: 'Timer starts when you begin writing. Target: 5 minutes.',
      runningMessage: 'Target: submit within 5 minutes. Hiding the timer keeps time running.',
      overTargetMessage: 'Past the 5-minute target, but you can still submit when ready.',
      startHiddenOnMobile: true,
      mobileQuery: '(max-width: 640px)',
      ...options
    };

    const els = config.elements;
    const state = {
      hidden: false,
      started: false,
      running: false,
      startedAt: null,
      elapsedBeforePause: 0
    };

    function elapsedSeconds() {
      if (!state.started) return 0;
      if (!state.running) return state.elapsedBeforePause;
      return state.elapsedBeforePause + Math.floor((Date.now() - state.startedAt) / 1000);
    }

    function isWithinTarget() {
      return elapsedSeconds() <= config.targetSeconds;
    }

    function render() {
      const elapsed = elapsedSeconds();
      els.display.textContent = formatSeconds(elapsed);
      els.display.classList.toggle('over-target', elapsed > config.targetSeconds);
      els.startBtn.disabled = state.started;
      els.pauseBtn.disabled = !state.running;
      els.pauseBtn.classList.toggle('hidden', state.started && !state.running);
      els.resumeBtn.classList.toggle('hidden', !state.started || state.running);

      if (!state.started) {
        els.note.textContent = config.idleMessage;
      } else if (!state.running) {
        els.note.textContent = `Paused at ${formatSeconds(elapsed)}.`;
      } else {
        els.note.textContent = elapsed > config.targetSeconds
          ? config.overTargetMessage
          : config.runningMessage;
      }
    }

    function start() {
      if (state.running) return;
      state.started = true;
      state.running = true;
      state.startedAt = Date.now();
      render();
    }

    function pause() {
      if (!state.running) return;
      state.elapsedBeforePause = elapsedSeconds();
      state.running = false;
      state.startedAt = null;
      render();
    }

    function resume() {
      if (!state.started || state.running) return;
      state.running = true;
      state.startedAt = Date.now();
      render();
    }

    function reset() {
      state.started = false;
      state.running = false;
      state.startedAt = null;
      state.elapsedBeforePause = 0;
      render();
    }

    function setHidden(hidden) {
      state.hidden = hidden;
      els.row.classList.toggle('minimized', state.hidden);
      els.toggleBtn.textContent = state.hidden ? 'Show timer' : 'Hide timer';
    }

    function initializeResponsiveVisibility() {
      const shouldHide = config.startHiddenOnMobile && window.matchMedia(config.mobileQuery).matches;
      setHidden(shouldHide);
    }

    function startFromInteraction() {
      if (!state.started) start();
    }

    els.toggleBtn.addEventListener('click', () => setHidden(!state.hidden));
    els.startBtn.addEventListener('click', start);
    els.pauseBtn.addEventListener('click', pause);
    els.resumeBtn.addEventListener('click', resume);
    els.resetBtn.addEventListener('click', reset);

    initializeResponsiveVisibility();
    render();
    setInterval(render, 1000);

    return {
      elapsedSeconds,
      formatSeconds,
      isWithinTarget,
      pause,
      render,
      reset,
      resume,
      start,
      startFromInteraction,
      hasStarted: () => state.started,
      isRunning: () => state.running,
      initializeResponsiveVisibility
    };
  }

  window.ActivityTimer = {
    create: createActivityTimer,
    formatSeconds
  };
})();
