(function (CodeMirror) {
  if (!CodeMirror) return;
  CodeMirror.defineMode('javascript', function () { return {}; });
  CodeMirror.defineMIME('application/json', 'javascript');
  CodeMirror.defineMIME('application/ld+json', 'javascript');
})(window.CodeMirror);
