class ChangeTracker {
  constructor() {
    this.dependencies = new Map();
    this.paths = new WeakMap();
  }

  recordChange(obj, prop, path) {
    if (!this.dependencies.has(obj)) {
      this.dependencies.set(obj, new Set());
    }
    this.dependencies.get(obj).add(prop);
    this.paths.set(obj, path);
    updateStatusIndicator('change');
  }

  hasDependency(obj, prop) {
    return this.dependencies.has(obj) && this.dependencies.get(obj).has(prop);
  }

  createChangeEvent(prop, path) {
    return {
      path: path ? `${path}.${prop}` : prop,
      timestamp: Date.now(),
    };
  }

  removeDependency(obj, prop) {
    if (this.dependencies.has(obj)) {
      this.dependencies.get(obj).delete(prop);
      if (this.dependencies.get(obj).size === 0) {
        this.dependencies.delete(obj);
      }
    }
  }
}

function updateStatusIndicator(type) {
  const indicator = document.querySelector('.status-indicator');
  if (!indicator) return;
  indicator.className = `status-indicator status-${type}`;
  setTimeout(() => {
    indicator.className = 'status-indicator';
  }, 500);
}

class CompositionObserver {
  static #observedObjects = [];

  static for(instance) {
    return new CompositionObserver(instance);
  }

  static clear() {
    // Clear all observed objects and terminate any active workers
    this.#observedObjects.forEach(({ worker }) => {
      if (worker) worker.terminate();
    });
    this.#observedObjects = [];
  }

  constructor(instance) {
    this.instance = instance;
    this.options = {
      observeNested: true,
      useWorker: false,
      onNewProperty: (prop, value, target, event) => Notify.info(`New property: ${prop} = ${value}, Path: ${event.path}`),
      onPropertyChange: (prop, oldValue, newValue, target, event) => Notify.info(`Property ${prop} changed from ${oldValue} to ${newValue}, Path: ${event.path}`),
      onPropertyDelete: (prop, oldValue, target, event) => Notify.info(`Property ${prop} deleted, old value: ${oldValue}, Path: ${event.path}`),
      onAccessFailure: (prop, value, target, event) => Notify.info(`Accessed undefined property: ${prop}, Path: ${event.path}`),
    };
    this.tracker = new ChangeTracker();
    this.proxyCache = new WeakMap();
    this.renderPending = false;
    this.worker = null;
    this.rootProxy = this.#createProxy(this.instance);
  }

  config(options) {
    if (options === true) {
      this.options.observeNested = true;
    } else if (options === false) {
      this.options.observeNested = false;
    } else if (options) {
      this.options = {
        ...this.options,
        observeNested: options.observeNested !== false,
        useWorker: options.useWorker || false,
        onNewProperty: options.onNewProperty || this.options.onNewProperty,
        onPropertyChange:
          options.onPropertyChange || this.options.onPropertyChange,
        onPropertyDelete:
          options.onPropertyDelete || this.options.onPropertyDelete,
        onAccessFailure:
          options.onAccessFailure || this.options.onAccessFailure,
      };
    }

    if (this.options.useWorker && !this.worker) {
      this.worker = new Worker('worker.js');
    } else if (!this.options.useWorker && this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.#render();
    return this;
  }

  start() {
    const el = document.getElementById('event-log');
    if (!el) {
      console.error('#event-log not found, cannot initialize observer');
      return this.instance;
    }

    CompositionObserver.#observedObjects.push({
      instance: this.instance,
      options: this.options,
      worker: this.worker,
    });

    this.#render();

    if (this.worker) {
      window.addEventListener('unload', () => this.worker.terminate());
    }

    return this.rootProxy;
  }

  #scheduleRender() {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.#render();
      this.renderPending = false;
    });
  }

  #render() {
    try {
      const eventLog = document.getElementById('event-log');
      if (!eventLog) {
        console.error('#event-log not found');
        return;
      }

      if (this.worker) {
        this.worker.postMessage({
          objects: CompositionObserver.#observedObjects.map((obj) => ({
            obj: obj.instance,
            depth: 0,
            visited: [],
          })),
        });
        this.worker.onmessage = (e) => {
          const { results } = e.data;
          if (!eventLog) {
            console.error('#event-log not found');
            return;
          }
          const lines = results;
          eventLog.innerHTML = lines.length
            ? `<pre class="composition-tree">${lines.join('\n')}</pre>`
            : '<div class="empty-state">Object tree will appear here when changes are made</div>';
        };
        this.worker.onerror = (error) => {
          console.error('Worker error:', error);
        };
      } else {
        const lines = [];
        CompositionObserver.#observedObjects.forEach((obj) => {
          lines.push(...this.#renderTree(obj.instance));
        });
        eventLog.innerHTML = lines.length
          ? `<pre class="composition-tree">${lines.join('\n')}</pre>`
          : '<div class="empty-state">Object tree will appear here when changes are made</div>';
      }
    } catch (error) {
      console.error('Render error:', error);
    }
  }

  #renderTree(obj, depth = 0, visited = new WeakSet()) {
    try {
      if (visited.has(obj)) {
        return [
          '  '.repeat(depth) +
            `* [circular reference to ${obj.constructor?.name || 'Object'}]`,
        ];
      }
      visited.add(obj);

      const lines = [
        '  '.repeat(depth) + `+ ${obj.constructor?.name || 'Object'}`,
      ];
      const keys = Object.keys(obj);
      for (const key of keys) {
        const val = obj[key];
        if (
          typeof val === 'object' &&
          val !== null &&
          typeof val !== 'function'
        ) {
          lines.push(...this.#renderTree(val, depth + 1, visited));
        } else {
          lines.push('  '.repeat(depth + 1) + `${key}: ${val}`);
        }
      }
      return lines;
    } catch (error) {
      console.error('renderTree error:', error);
      return ['  '.repeat(depth) + '[Error rendering object]'];
    }
  }

  #createProxy(target, parentPath = '') {
    if (this.proxyCache.has(target)) return this.proxyCache.get(target);

    const handler = {
      set: (target, prop, value, receiver) => {
        const oldValue = target[prop];
        const hadProperty = Object.prototype.hasOwnProperty.call(target, prop);
        const wasSeenBefore = this.tracker.hasDependency(target, prop);
        let newValue = value;

        if (
          this.options.observeNested &&
          typeof value === 'object' &&
          value !== null &&
          !this.proxyCache.has(value)
        ) {
          newValue = this.#createProxy(
            value,
            `${parentPath ? `${parentPath}.` : ''}${prop}`,
          );
        }

        const result = Reflect.set(target, prop, newValue, receiver);
        const changeEvent = this.tracker.createChangeEvent(prop, parentPath);
        this.tracker.recordChange(target, prop, parentPath);

        if (!wasSeenBefore && !hadProperty && this.options.onNewProperty) {
          this.options.onNewProperty(prop, newValue, target, changeEvent);
        } else if (
          wasSeenBefore &&
          oldValue !== newValue &&
          this.options.onPropertyChange
        ) {
          this.options.onPropertyChange(
            prop,
            oldValue,
            newValue,
            target,
            changeEvent,
          );
        }

        this.#scheduleRender();
        return result;
      },

      get: (target, prop, receiver) => {
        if (typeof prop !== 'string' || prop === 'Symbol(Symbol.toStringTag)') {
          return Reflect.get(target, prop, receiver);
        }

        const hasProperty = Reflect.has(target, prop);
        const value = Reflect.get(target, prop, receiver);

        if (
          !hasProperty &&
          this.options.onAccessFailure &&
          value === undefined
        ) {
          const changeEvent = this.tracker.createChangeEvent(prop, parentPath);
          this.options.onAccessFailure(prop, undefined, target, changeEvent);
        }

        if (
          this.options.observeNested &&
          typeof value === 'object' &&
          value !== null &&
          !this.proxyCache.has(value) &&
          typeof value !== 'function'
        ) {
          const proxiedValue = this.#createProxy(
            value,
            `${parentPath ? `${parentPath}.` : ''}${prop}`,
          );
          Reflect.set(target, prop, proxiedValue, receiver);
          return proxiedValue;
        }

        return value;
      },

      deleteProperty: (target, prop) => {
        const oldValue = target[prop];
        const hadProperty = Object.prototype.hasOwnProperty.call(target, prop);
        const result = Reflect.deleteProperty(target, prop);

        if (hadProperty && this.options.onPropertyDelete) {
          const changeEvent = this.tracker.createChangeEvent(prop, parentPath);
          this.options.onPropertyDelete(prop, oldValue, target, changeEvent);
          this.tracker.removeDependency(target, prop);
          updateStatusIndicator('delete');
        }

        this.#scheduleRender();
        return result;
      },

      ownKeys: (target) => Reflect.ownKeys(target),
      getOwnPropertyDescriptor: (target, prop) =>
        Reflect.getOwnPropertyDescriptor(target, prop),
    };

    const proxy = new Proxy(target, handler);
    this.proxyCache.set(target, proxy);
    return proxy;
  }
}