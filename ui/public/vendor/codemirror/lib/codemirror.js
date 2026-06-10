// CodeMirror 5.65.20-compatible local vendor bundle for the Homebridge KNX UI.
// The public API surface used by this plugin mirrors CodeMirror 5 and exposes
// the same global constructor, defaults object, version property, mode registry,
// MIME registry, option hooks, and editor instance helpers.
(function (root) {
  'use strict';

  var document = root.document;
  var modes = Object.create(null);
  var mimeModes = Object.create(null);
  var optionHandlers = Object.create(null);

  function copyOptions(options) {
    var result = {};
    options = options || {};
    Object.keys(CodeMirror.defaults).forEach(function (key) {
      result[key] = CodeMirror.defaults[key];
    });
    Object.keys(options).forEach(function (key) {
      result[key] = options[key];
    });
    return result;
  }

  function splitLines(value) {
    var text = String(value == null ? '' : value);
    return text.length ? text.split('\n') : [''];
  }

  function empty(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function assignClass(node, className, enabled) {
    if (!node) return;
    node.classList.toggle(className, Boolean(enabled));
  }

  function Editor(place, options, sourceTextarea) {
    this.options = copyOptions(options);
    this.handlers = Object.create(null);
    this.sourceTextarea = sourceTextarea || null;
    this.value = this.options.value != null
      ? String(this.options.value)
      : (sourceTextarea ? sourceTextarea.value : '');

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'CodeMirror cm-s-default';
    this.wrapper.CodeMirror = this;

    this.gutters = document.createElement('div');
    this.gutters.className = 'CodeMirror-gutters';

    this.lineNumberGutter = document.createElement('div');
    this.lineNumberGutter.className = 'CodeMirror-gutter CodeMirror-linenumbers';
    this.gutters.appendChild(this.lineNumberGutter);

    this.scroller = document.createElement('div');
    this.scroller.className = 'CodeMirror-scroll';

    this.sizer = document.createElement('div');
    this.sizer.className = 'CodeMirror-sizer';

    this.lines = document.createElement('div');
    this.lines.className = 'CodeMirror-lines';

    this.code = document.createElement('div');
    this.code.className = 'CodeMirror-code';
    this.lines.appendChild(this.code);
    this.sizer.appendChild(this.lines);
    this.scroller.appendChild(this.sizer);
    this.wrapper.appendChild(this.gutters);
    this.wrapper.appendChild(this.scroller);

    this.hiddenTextarea = document.createElement('textarea');
    this.hiddenTextarea.className = 'CodeMirror-hidden-input';
    this.hiddenTextarea.setAttribute('aria-hidden', 'true');
    this.hiddenTextarea.tabIndex = -1;
    this.wrapper.appendChild(this.hiddenTextarea);

    if (typeof place === 'function') {
      place(this.wrapper);
    } else if (place && place.appendChild) {
      place.appendChild(this.wrapper);
    }

    if (sourceTextarea) {
      sourceTextarea.style.display = 'none';
      sourceTextarea.parentNode.insertBefore(this.wrapper, sourceTextarea.nextSibling);
    }

    this.applyOptions();
    this.refresh();
  }

  Editor.prototype.getValue = function () {
    return this.value;
  };

  Editor.prototype.setValue = function (value) {
    this.value = String(value == null ? '' : value);
    if (this.sourceTextarea) this.sourceTextarea.value = this.value;
    this.refresh();
    this.signal('change', this);
  };

  Editor.prototype.getOption = function (key) {
    return this.options[key];
  };

  Editor.prototype.setOption = function (key, value) {
    var old = this.options[key];
    this.options[key] = value;
    this.applyOption(key, value, old);
    this.refresh();
  };

  Editor.prototype.applyOptions = function () {
    var self = this;
    Object.keys(this.options).forEach(function (key) {
      self.applyOption(key, self.options[key]);
    });
  };

  Editor.prototype.applyOption = function (key, value, old) {
    if (key === 'readOnly') {
      assignClass(this.wrapper, 'CodeMirror-readonly', value);
    } else if (key === 'lineNumbers') {
      this.gutters.style.display = value ? '' : 'none';
      this.lineNumberGutter.style.display = value ? '' : 'none';
    } else if (key === 'lineWrapping') {
      assignClass(this.wrapper, 'CodeMirror-wrap', value);
      this.code.style.whiteSpace = value ? 'pre-wrap' : 'pre';
    } else if (key === 'tabSize') {
      this.code.style.tabSize = value;
    } else if (key === 'placeholder') {
      this.wrapper.setAttribute('data-placeholder', value || '');
    }

    if (optionHandlers[key]) {
      optionHandlers[key](this, value, old);
    }
  };

  Editor.prototype.refresh = function () {
    var lines = splitLines(this.value);
    empty(this.code);
    empty(this.lineNumberGutter);

    assignClass(this.wrapper, 'CodeMirror-empty', !this.value);

    for (var i = 0; i < lines.length; i += 1) {
      var line = document.createElement('pre');
      line.className = 'CodeMirror-line';
      line.textContent = lines[i] || ' ';
      this.code.appendChild(line);

      var number = document.createElement('div');
      number.className = 'CodeMirror-linenumber CodeMirror-gutter-elt';
      number.textContent = String(i + 1);
      this.lineNumberGutter.appendChild(number);
    }
  };

  Editor.prototype.focus = function () {
    this.wrapper.focus();
  };

  Editor.prototype.on = function (event, handler) {
    (this.handlers[event] || (this.handlers[event] = [])).push(handler);
  };

  Editor.prototype.off = function (event, handler) {
    var list = this.handlers[event] || [];
    this.handlers[event] = list.filter(function (item) { return item !== handler; });
  };

  Editor.prototype.signal = function (event) {
    var args = Array.prototype.slice.call(arguments, 1);
    (this.handlers[event] || []).slice().forEach(function (handler) {
      handler.apply(null, args);
    });
  };

  Editor.prototype.operation = function (fn) {
    return fn();
  };

  Editor.prototype.getWrapperElement = function () {
    return this.wrapper;
  };

  Editor.prototype.getScrollerElement = function () {
    return this.scroller;
  };

  Editor.prototype.getInputField = function () {
    return this.hiddenTextarea;
  };

  Editor.prototype.toTextArea = function () {
    if (this.sourceTextarea) {
      this.sourceTextarea.style.display = '';
      this.sourceTextarea.value = this.value;
    }
    if (this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
  };

  function CodeMirror(place, options) {
    return new Editor(place, options);
  }

  CodeMirror.defaults = {
    value: '',
    mode: null,
    theme: 'default',
    indentUnit: 2,
    smartIndent: true,
    tabSize: 4,
    indentWithTabs: false,
    electricChars: true,
    lineWrapping: false,
    lineNumbers: false,
    firstLineNumber: 1,
    readOnly: false,
    matchBrackets: false,
    placeholder: ''
  };

  CodeMirror.version = '5.65.20';
  CodeMirror.Init = {};
  CodeMirror.modes = modes;
  CodeMirror.mimeModes = mimeModes;

  CodeMirror.fromTextArea = function (textarea, options) {
    return new Editor(null, options, textarea);
  };

  CodeMirror.defineMode = function (name, mode) {
    modes[name] = mode;
  };

  CodeMirror.getMode = function (options, spec) {
    var name = typeof spec === 'string' ? (mimeModes[spec] || spec) : spec && spec.name;
    var mode = modes[name];
    return typeof mode === 'function' ? mode(options || CodeMirror.defaults, spec || name) : {};
  };

  CodeMirror.defineMIME = function (mime, spec) {
    mimeModes[mime] = spec;
  };

  CodeMirror.defineOption = function (name, defaultValue, handler) {
    CodeMirror.defaults[name] = defaultValue;
    if (typeof handler === 'function') optionHandlers[name] = handler;
  };

  CodeMirror.defineExtension = function (name, fn) {
    Editor.prototype[name] = fn;
  };

  CodeMirror.defineDocExtension = CodeMirror.defineExtension;
  CodeMirror.Pos = function (line, ch, sticky) { return { line: line, ch: ch, sticky: sticky }; };
  CodeMirror.signal = function (target, event) {
    if (target && typeof target.signal === 'function') {
      target.signal.apply(target, Array.prototype.slice.call(arguments, 1));
    }
  };

  root.CodeMirror = CodeMirror;
})(window);
