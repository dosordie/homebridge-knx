// Match-brackets option hook compatible with CodeMirror 5.
(function(mod) {
  if (typeof exports == "object" && typeof module == "object") mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) define(["../../lib/codemirror"], mod);
  else mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  CodeMirror.defineOption("matchBrackets", false, function(cm, val) {
    var wrapper = cm && cm.getWrapperElement && cm.getWrapperElement();
    if (wrapper) wrapper.classList.toggle("CodeMirror-matchingbrackets", Boolean(val));
  });

  CodeMirror.defineExtension("matchBrackets", function() {
    return null;
  });
});
