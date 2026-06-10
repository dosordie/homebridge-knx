/* Lightweight local CodeMirror 5-compatible adapter for static Homebridge custom UIs. */
(function (root) {
  'use strict';

  function splitLines(value) {
    var text = String(value || '');
    return text.length ? text.split('\n') : [''];
  }

  function optionValue(options, key, fallback) {
    return Object.prototype.hasOwnProperty.call(options, key) ? options[key] : fallback;
  }

  function Editor(textarea, options) {
    this.textarea = textarea;
    this.options = Object.assign({}, options || {});
    this.handlers = Object.create(null);
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'CodeMirror';
    this.scroller = document.createElement('div');
    this.scroller.className = 'CodeMirror-scroll';
    this.gutters = document.createElement('div');
    this.gutters.className = 'CodeMirror-gutters';
    this.codeWrap = document.createElement('div');
    this.codeWrap.className = 'CodeMirror-codewrap';
    this.code = textarea;
    this.code.classList.remove('form-control');
    this.code.classList.add('CodeMirror-code');
    this.codeWrap.appendChild(this.code);
    this.scroller.appendChild(this.gutters);
    this.scroller.appendChild(this.codeWrap);
    this.wrapper.appendChild(this.scroller);
    textarea.parentNode.insertBefore(this.wrapper, textarea);
    this.setOption('lineNumbers', optionValue(this.options, 'lineNumbers', false));
    this.setOption('lineWrapping', optionValue(this.options, 'lineWrapping', false));
    this.setOption('tabSize', optionValue(this.options, 'tabSize', 4));
    this.setOption('readOnly', optionValue(this.options, 'readOnly', false));
    textarea.addEventListener('input', this.refresh.bind(this));
    textarea.addEventListener('scroll', this.syncScroll.bind(this));
    this.refresh();
  }

  Editor.prototype.getValue = function () {
    return this.code.value;
  };

  Editor.prototype.setValue = function (value) {
    this.code.value = value || '';
    this.refresh();
  };

  Editor.prototype.setOption = function (key, value) {
    this.options[key] = value;
    if (key === 'readOnly') {
      this.code.readOnly = Boolean(value);
      this.code.disabled = false;
    }
    if (key === 'lineNumbers') {
      this.gutters.style.display = value ? '' : 'none';
    }
    if (key === 'lineWrapping') {
      this.code.style.whiteSpace = value ? 'pre-wrap' : 'pre';
      this.code.style.overflowX = value ? 'hidden' : 'auto';
    }
    if (key === 'tabSize') {
      this.code.style.tabSize = value;
    }
  };

  Editor.prototype.getOption = function (key) {
    return this.options[key];
  };

  Editor.prototype.refresh = function () {
    var count = splitLines(this.code.value).length;
    var html = '';
    for (var line = 1; line <= count; line += 1) {
      html += '<div class="CodeMirror-linenumber">' + line + '</div>';
    }
    this.gutters.innerHTML = html;
    this.syncScroll();
  };

  Editor.prototype.syncScroll = function () {
    this.gutters.scrollTop = this.code.scrollTop;
  };

  Editor.prototype.focus = function () {
    this.code.focus();
  };

  Editor.prototype.on = function (event, handler) {
    (this.handlers[event] || (this.handlers[event] = [])).push(handler);
  };

  Editor.prototype.off = function (event, handler) {
    var list = this.handlers[event] || [];
    this.handlers[event] = list.filter(function (item) { return item !== handler; });
  };

  Editor.prototype.operation = function (fn) {
    return fn();
  };

  Editor.prototype.getWrapperElement = function () {
    return this.wrapper;
  };

  Editor.prototype.toTextArea = function () {
    this.wrapper.parentNode.insertBefore(this.code, this.wrapper);
    this.wrapper.remove();
    this.code.classList.add('form-control');
    this.code.classList.remove('CodeMirror-code');
  };

  function CodeMirror(place, options) {
    var textarea = document.createElement('textarea');
    if (typeof place === 'function') {
      place(textarea);
    } else if (place && place.appendChild) {
      place.appendChild(textarea);
    }
    return new Editor(textarea, options);
  }

  CodeMirror.fromTextArea = function (textarea, options) {
    return new Editor(textarea, options);
  };
  CodeMirror.defineMode = function () {};
  CodeMirror.defineMIME = function () {};
  CodeMirror.defineOption = function () {};
  CodeMirror.defineExtension = function (name, fn) {
    Editor.prototype[name] = fn;
  };
  CodeMirror.Pos = function (line, ch) { return { line: line, ch: ch }; };
  CodeMirror.Init = {};

  root.CodeMirror = CodeMirror;
})(window);
