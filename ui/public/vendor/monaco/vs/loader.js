(function (global) {
  'use strict';

  var registry = Object.create(null);
  var pending = Object.create(null);
  var configuration = { paths: Object.create(null) };

  function normalize(moduleId) {
    return String(moduleId || '').replace(/\.js$/, '');
  }

  function moduleToUrl(moduleId) {
    var normalized = normalize(moduleId);
    var segments = normalized.split('/');
    var first = segments[0];
    var mapped = configuration.paths[first];

    if (mapped) {
      segments[0] = mapped.replace(/\/$/, '');
      return segments.join('/') + '.js';
    }

    return normalized + '.js';
  }

  function loadScript(moduleId, onload, onerror) {
    var normalized = normalize(moduleId);

    if (registry[normalized]) {
      onload();
      return;
    }

    if (pending[normalized]) {
      pending[normalized].push([onload, onerror]);
      return;
    }

    pending[normalized] = [[onload, onerror]];

    var script = document.createElement('script');
    script.async = true;
    script.charset = 'utf-8';
    script.src = moduleToUrl(normalized);
    script.onload = function () {
      var listeners = pending[normalized] || [];
      delete pending[normalized];
      listeners.forEach(function (listener) { listener[0](); });
    };
    script.onerror = function () {
      var error = new Error('Unable to load AMD module ' + normalized + ' from ' + script.src + '.');
      var listeners = pending[normalized] || [];
      delete pending[normalized];
      listeners.forEach(function (listener) { listener[1](error); });
    };
    document.head.appendChild(script);
  }

  function resolve(dependencies, callback, onerror) {
    var remaining = dependencies.length;
    var exports = new Array(dependencies.length);

    if (remaining === 0) {
      callback.apply(global, exports);
      return;
    }

    dependencies.forEach(function (dependency, index) {
      var normalized = normalize(dependency);
      loadScript(normalized, function () {
        exports[index] = registry[normalized] ? registry[normalized].exports : undefined;
        remaining -= 1;
        if (remaining === 0) {
          callback.apply(global, exports);
        }
      }, onerror || function (error) { setTimeout(function () { throw error; }, 0); });
    });
  }

  function define(moduleId, dependencies, factory) {
    if (typeof moduleId !== 'string') {
      factory = dependencies;
      dependencies = moduleId;
      moduleId = document.currentScript && document.currentScript.getAttribute('data-amd-module');
    }

    if (!Array.isArray(dependencies)) {
      factory = dependencies;
      dependencies = [];
    }

    var normalized = normalize(moduleId || 'vs/editor/editor.main');
    var module = { exports: {} };

    function finish() {
      var args = dependencies.map(function (dependency) {
        if (dependency === 'require') return require;
        if (dependency === 'exports') return module.exports;
        if (dependency === 'module') return module;
        var dependencyModule = registry[normalize(dependency)];
        return dependencyModule ? dependencyModule.exports : undefined;
      });
      var result = typeof factory === 'function' ? factory.apply(global, args) : factory;
      if (typeof result !== 'undefined') {
        module.exports = result;
      }
      registry[normalized] = module;
    }

    var externalDependencies = dependencies.filter(function (dependency) {
      return dependency !== 'require' && dependency !== 'exports' && dependency !== 'module' && !registry[normalize(dependency)];
    });

    if (externalDependencies.length) {
      resolve(externalDependencies, finish);
    } else {
      finish();
    }
  }

  function require(dependencies, callback, onerror) {
    if (typeof dependencies === 'string') {
      var normalized = normalize(dependencies);
      return registry[normalized] ? registry[normalized].exports : undefined;
    }
    resolve(dependencies || [], callback || function () {}, onerror);
  }

  require.config = function (nextConfiguration) {
    nextConfiguration = nextConfiguration || {};
    configuration.paths = Object.assign(configuration.paths, nextConfiguration.paths || {});
    return require;
  };

  define.amd = {};

  global.define = global.define || define;
  global.require = global.require || require;
}(this));
