// composition-observer.js

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

  getPath(obj) {
    return this.paths.get(obj) || '';
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

const Composition = {
  observedObjects: [],

  observe(instance, options = {}) {
    const el = document.getElementById('event-log');
    if (!el) {
      console.error('#event-log not found, cannot initialize observer');
      return instance;
    }

    this.observedObjects.push({ instance, options });

    const tracker = new ChangeTracker();
    const proxyCache = new WeakMap();
    let renderPending = false;
    const worker = options.useWorker ? new Worker('worker.js') : null;

    function scheduleRender() {
      if (renderPending) {
        // console.log('Render already scheduled, skipping');
        return;
      }
      renderPending = true;
      requestAnimationFrame(() => {
        // console.log('Rendering observed objects');
        render();
        renderPending = false;
      });
    }

    function render() {
      try {
        const eventLog = document.getElementById('event-log');
        if (!eventLog) {
          console.error('#event-log not found');
          return;
        }

        if (worker) {
          worker.postMessage({
            objects: Composition.observedObjects
              .filter(obj => obj.instance.constructor.name === 'Sprite')
              .map(obj => ({ obj: obj.instance, depth: 0, visited: [] })),
          });
        } else {
          const lines = [];
          Composition.observedObjects.forEach(obj => {
            if (obj.instance.constructor.name === 'Sprite') {
              lines.push(...renderTree(obj.instance));
            }
          });
          eventLog.innerHTML = `<pre class="composition-tree">${lines.join('\n')}</pre>`;
        }
      } catch (error) {
        console.error('Render error:', error);
      }
    }

    if (worker) {
      worker.onmessage = function (e) {
        const { results } = e.data;
        const eventLog = document.getElementById('event-log');
        if (!eventLog) {
          console.error('#event-log not found');
          return;
        }
        const lines = [];
        results.forEach(result => {
          lines.push(result);
        });
        eventLog.innerHTML = `<pre class="composition-tree">${lines.join('\n')}</pre>`;
      };
      worker.onerror = function (error) {
        console.error('Worker error:', error);
      };
    }

    function renderTree(obj, depth = 0, visited = new WeakSet()) {
      try {
        if (visited.has(obj)) {
          return ['  '.repeat(depth) + `* [circular reference to ${obj.constructor?.name || 'Object'}]`];
        }
        visited.add(obj);

        const lines = ['  '.repeat(depth) + `+ ${obj.constructor?.name || 'Object'}`];
        const keys = Object.keys(obj);
        for (const key of keys) {
          const val = obj[key];
          if (typeof val === 'object' && val !== null && typeof val !== 'function') {
            lines.push(...renderTree(val, depth + 1, visited));
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

    function createProxy(target, parentPath = '') {
      if (proxyCache.has(target)) return proxyCache.get(target);

      const handler = {
        set(target, prop, value, receiver) {
          const oldValue = target[prop];
          const hadProperty = Object.prototype.hasOwnProperty.call(target, prop);
          const wasSeenBefore = tracker.hasDependency(target, prop);
          let newValue = value;

          if (options.observeNested !== false && typeof value === 'object' && value !== null && !proxyCache.has(value)) {
            newValue = createProxy(value, `${parentPath ? `${parentPath}.` : ''}${prop}`);
          }

          const result = Reflect.set(target, prop, newValue, receiver);

          const changeEvent = tracker.createChangeEvent(prop, parentPath);
          tracker.recordChange(target, prop, parentPath);

          if (!wasSeenBefore) {
            if (!hadProperty && options.onNewProperty) {
              options.onNewProperty(prop, newValue, target, changeEvent);
            }
          } else if (oldValue !== newValue && options.onPropertyChange) {
            options.onPropertyChange(prop, oldValue, newValue, target, changeEvent);
          }

          // console.log(`Scheduling render for ${prop} change`);
          scheduleRender();
          return result;
        },

        get(target, prop, receiver) {
          // Skip internal or non-string properties
          if (typeof prop !== 'string' || prop === 'Symbol(Symbol.toStringTag)') {
            return Reflect.get(target, prop, receiver);
          }

          // Check if property exists
          const hasProperty = Reflect.has(target, prop);
          const value = Reflect.get(target, prop, receiver);

          // Trigger onAccessFailure for non-existent properties
          if (!hasProperty && options.onAccessFailure && value === undefined) {
            const changeEvent = tracker.createChangeEvent(prop, parentPath);
            options.onAccessFailure(prop, undefined, target, changeEvent);
          }

          // Handle nested objects
          if (options.observeNested !== false && typeof value === 'object' && value !== null && !proxyCache.has(value) && typeof value !== 'function') {
            const proxiedValue = createProxy(value, `${parentPath ? `${parentPath}.` : ''}${prop}`);
            Reflect.set(target, prop, proxiedValue, receiver);
            return proxiedValue;
          }

          return value;
        },

        deleteProperty(target, prop) {
          const oldValue = target[prop];
          const hadProperty = Object.prototype.hasOwnProperty.call(target, prop);
          const result = Reflect.deleteProperty(target, prop);

          if (hadProperty && options.onPropertyDelete) {
            const changeEvent = tracker.createChangeEvent(prop, parentPath);
            options.onPropertyDelete(prop, oldValue, target, changeEvent);
            tracker.removeDependency(target, prop);
            updateStatusIndicator('delete');
          }

          // console.log(`Scheduling render for ${prop} deletion`);
          scheduleRender();
          return result;
        },

        ownKeys(target) {
          return Reflect.ownKeys(target);
        },

        getOwnPropertyDescriptor(target, prop) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      };

      const proxy = new Proxy(target, handler);
      proxyCache.set(target, proxy);
      return proxy;
    }

    const rootProxy = createProxy(instance);
    // console.log('Initial render');
    render();

    if (worker) {
      window.addEventListener('unload', () => worker.terminate());
    }

    return rootProxy;
  },
};