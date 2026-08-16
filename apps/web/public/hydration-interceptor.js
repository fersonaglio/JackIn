(function() {
  const originalError = console.error;
  console.error = function(...args) {
    const msg = args.map(x => typeof x === 'object' ? (x?.message || JSON.stringify(x)) : String(x)).join(' ');
    if (
      msg.includes('Hydration failed') || 
      msg.includes('hydration-mismatch') || 
      msg.includes('did not match') || 
      msg.includes('brk_yuan') ||
      msg.includes('Encountered a script tag') ||
      msg.includes('The play() request was interrupted')
    ) {
      return;
    }
    originalError.apply(console, args);
  };

  window.addEventListener('error', function(event) {
    const msg = event.message || '';
    if (
      msg.includes('Hydration failed') || 
      msg.includes('hydration-mismatch') || 
      msg.includes('did not match') || 
      msg.includes('brk_yuan') ||
      msg.includes('Encountered a script tag')
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, true);

  window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason?.message || '';
    if (reason.includes('The play() request was interrupted')) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
})();
