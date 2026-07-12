(function () {
  "use strict";
  if (window.self === window.top) return; // only run when embedded in an iframe

  // .app uses min-height:100vh, and 100vh inside an iframe resolves against
  // the iframe's own box height. If we resized to scrollHeight unthrottled,
  // any growth would feed back into a taller vh next tick. Debounce to one
  // measurement per frame, skip no-op messages, and hard-cap the height so
  // that loop can't run away.
  var MAX_HEIGHT = 4000;
  var lastHeight = 0;
  var scheduled = false;

  function measure() {
    scheduled = false;
    var height = Math.min(document.documentElement.scrollHeight, MAX_HEIGHT);
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    window.parent.postMessage({ type: "18words:resize", height: height }, "*");
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(measure);
  }

  window.addEventListener("load", schedule);
  window.addEventListener("resize", schedule);

  if (window.ResizeObserver) {
    new ResizeObserver(schedule).observe(document.documentElement);
  } else {
    setInterval(schedule, 500);
  }

  schedule();
})();
