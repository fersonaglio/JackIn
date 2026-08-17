(function() {
  // Extensões de navegador injetam nós no DOM servido (ex.: <div id="brk_yuan">,
  // banners, helpers) entre o SSR e a hidratação do React. Esses nós causam
  // "Hydration failed because the server rendered HTML didn't match the client"
  // no console/dev-overlay. Este script roda ANTES da hidratação e:
  //   1) remove nós DOM injetados por extensões conhecidas;
  //   2) silencia os erros de hidratação que escaparem.
  function cleanInjectedNodes(root) {
    var candidates = [];
    try {
      candidates = Array.prototype.slice.call((root || document).querySelectorAll(
        '[id="brk_yuan"], [data-extension], .brk_yuan, [id*="_reward_"], .reward-banner'
      ));
    } catch (e) {}
    candidates.forEach(function(node) {
      if (node && node.parentNode && node.parentNode.nodeType === 1) {
        node.parentNode.removeChild(node);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { cleanInjectedNodes(document); });
  } else {
    cleanInjectedNodes(document);
  }

  var originalError = console.error;
  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    var msg = args.map(function(x) {
      if (typeof x === 'object' && x !== null) return x.message || JSON.stringify(x);
      return String(x);
    }).join(' ');
    if (
      msg.indexOf('Hydration failed') !== -1 ||
      msg.indexOf('hydration-mismatch') !== -1 ||
      msg.indexOf('did not match') !== -1 ||
      msg.indexOf('brk_yuan') !== -1 ||
      msg.indexOf('Encountered a script tag') !== -1
    ) {
      return;
    }
    originalError.apply(console, args);
  };

  window.addEventListener('error', function(event) {
    var msg = (event && event.message) || '';
    if (
      msg.indexOf('Hydration failed') !== -1 ||
      msg.indexOf('hydration-mismatch') !== -1 ||
      msg.indexOf('did not match') !== -1 ||
      msg.indexOf('brk_yuan') !== -1
    ) {
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (event.preventDefault) event.preventDefault();
    }
  }, true);

  window.addEventListener('unhandledrejection', function(event) {
    var reason = (event && event.reason && event.reason.message) || '';
    if (reason.indexOf('The play() request was interrupted') !== -1) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
    }
  });
})();
