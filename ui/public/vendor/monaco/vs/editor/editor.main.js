define('vs/editor/editor.main', [], function () {
  'use strict';

  function createModel(initialValue, language) {
    return {
      language: language || 'plaintext',
      getValue: function () { return initialValue; },
      setValue: function (value) { initialValue = String(value == null ? '' : value); }
    };
  }

  function applyTheme(element, theme) {
    var dark = String(theme || '').toLowerCase().indexOf('dark') !== -1;
    element.style.background = dark ? '#1e1e1e' : '#ffffff';
    element.style.color = dark ? '#d4d4d4' : '#1f2328';
    element.style.caretColor = dark ? '#ffffff' : '#000000';
  }

  var languages = [
    { id: 'json', extensions: ['.json'], aliases: ['JSON', 'json'] },
    { id: 'plaintext', extensions: ['.txt'], aliases: ['Plain Text', 'text'] }
  ];

  var monaco = window.monaco = window.monaco || {};
  monaco.languages = monaco.languages || {};
  monaco.languages.getLanguages = function () { return languages.slice(); };

  monaco.editor = monaco.editor || {};
  monaco.editor.setTheme = function (theme) {
    monaco.editor._theme = theme;
    document.querySelectorAll('.monaco-editor textarea').forEach(function (textarea) {
      applyTheme(textarea, theme);
    });
  };

  monaco.editor.setModelLanguage = function (model, language) {
    if (model) model.language = language || 'plaintext';
  };

  monaco.editor.create = function (container, options) {
    options = options || {};
    var model = createModel(String(options.value == null ? '' : options.value), options.language);
    var textarea = document.createElement('textarea');
    textarea.className = 'monaco-mouse-cursor-text';
    textarea.spellcheck = false;
    textarea.value = model.getValue();
    textarea.readOnly = Boolean(options.readOnly);
    textarea.wrap = options.wordWrap === 'on' ? 'soft' : 'off';
    textarea.style.boxSizing = 'border-box';
    textarea.style.width = '100%';
    textarea.style.height = '100%';
    textarea.style.minHeight = '320px';
    textarea.style.border = '0';
    textarea.style.outline = '0';
    textarea.style.resize = 'none';
    textarea.style.padding = '12px';
    textarea.style.font = '13px/1.5 Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    textarea.style.tabSize = '2';
    applyTheme(textarea, options.theme || monaco.editor._theme || 'vs');

    container.classList.add('monaco-editor');
    container.innerHTML = '';
    container.appendChild(textarea);

    textarea.addEventListener('input', function () { model.setValue(textarea.value); });

    return {
      getValue: function () { return textarea.value; },
      setValue: function (value) { textarea.value = String(value == null ? '' : value); model.setValue(textarea.value); },
      getModel: function () { return model; },
      updateOptions: function (nextOptions) {
        nextOptions = nextOptions || {};
        if (Object.prototype.hasOwnProperty.call(nextOptions, 'readOnly')) textarea.readOnly = Boolean(nextOptions.readOnly);
        if (Object.prototype.hasOwnProperty.call(nextOptions, 'theme')) applyTheme(textarea, nextOptions.theme);
      },
      layout: function () {},
      dispose: function () { if (textarea.parentNode) textarea.parentNode.removeChild(textarea); }
    };
  };

  return monaco;
});
