// YAML mode registration compatible with CodeMirror 5.
(function(mod) {
  if (typeof exports == "object" && typeof module == "object") mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) define(["../../lib/codemirror"], mod);
  else mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  CodeMirror.defineMode("yaml", function() {
    return {
      startState: function() { return {}; },
      token: function(stream) {
        if (stream.eatSpace && stream.eatSpace()) return null;
        if (stream.next) stream.next();
        return null;
      }
    };
  });

  CodeMirror.defineMIME("text/x-yaml", "yaml");
  CodeMirror.defineMIME("text/yaml", "yaml");
  CodeMirror.defineMIME("application/x-yaml", "yaml");
});
