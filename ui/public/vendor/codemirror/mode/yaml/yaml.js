(function (CodeMirror) {
  if (!CodeMirror) return;
  CodeMirror.defineMode('yaml', function () { return {}; });
  CodeMirror.defineMIME('text/x-yaml', 'yaml');
})(window.CodeMirror);
