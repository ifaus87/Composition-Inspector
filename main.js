// Last Edited
// 15 Jul 2025

// A light weight Composition Observer, utilizing Proxy to determine when properties of the observed object
// have been added, changed or deleted.
// Potential for future development of declaring what the property is, ie class, function, etc

class Sprite {
  constructor() {
    this.x = null;
    this.y = null;
  }
}

class Position {
  constructor() {
    this.x = undefined;
    this.y = undefined;
  }
  set(x,y) {
    this.x = x;
    this.y = y;
  }
}

// Global variables
let observedObject = null;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
  initializeComposition();
});

function initializeComposition() {
  const sprite = new Sprite();
  observedObject = CompositionObserver.for(sprite).start();
}


// Test functions called by HTML buttons
function testNestedChanges() {
  if (!observedObject) {
    Notify.error('Observed object not initialized');
    return;
  }
  if (!Dependency.for(observedObject).exists(Position)) {
    Dependency.for(observedObject).register(Position);
  }else{
    Notify.info(`Component dependency has already been registered.`);
    return;
  }
}

function testPositionSet() {
  if (!observedObject) {
    Notify.error('Observed object not initialized');
    return;
  }
  if (Dependency.for(observedObject).exists(Position)) {
    observedObject.position.set(10,10);
  }else{
    const value = observedObject.position; // Attempt to access position
  }
}

function clearLog() {
  const eventLog = document.getElementById('event-log');
  if (eventLog) {
    eventLog.innerHTML = '<div class="empty-state">Object tree will appear here when changes are made</div>';
  }

  // Clear notifications
  const notifications = document.querySelectorAll('.notification');
  notifications.forEach((notification) => notification.remove());

  // Clear CompositionObserver state
  CompositionObserver.clear();

  // Reinitialize with a new Sprite instance
  setTimeout(() => {
    initializeComposition();
  }, 1000);
}


const Notify = (() => {
  const types = {
    success: '✅',
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
  };

  const api = {
    show(message, type = 'info') {
      const notification = document.createElement('div');
      notification.className = `notification notification-${type}`;
      notification.innerHTML = `
        <span class="notification-icon">${types[type] || types.info}</span>
        <span class="notification-message">${message}</span>
      `;
      document.body.appendChild(notification);

      setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
          notification.remove();
        }, 300);
      }, 3000);
    }
  };

  // Generate shortcut methods like info(), error(), etc.
  for (const type in types) {
    api[type] = (message) => api.show(message, type);
  }

  return api;
})();



// Advanced testing functions
function runStressTest() {
  if (!observedObject) return;

  console.log('Running stress test...');

  for (let i = 0; i < 50; i++) {
    setTimeout(() => {
      observedObject[`dynamicProp${i}`] = {
        value: Math.random(),
        timestamp: Date.now(),
        nested: {
          level1: {
            level2: {
              data: `test-${i}`,
            },
          },
        },
      };
    }, i * 10);
  }
}

function testCircularReference() {
  if (!observedObject) return;

  observedObject.circular = observedObject;
}

function addComplexNesting() {
  if (!observedObject) return;

  observedObject.complex = {
    level1: {
      level2: {
        level3: {
          level4: {
            data: 'deeply nested',
            array: [1, 2, { nested: 'in array' }],
            fn: function () {
              return 'I am a function';
            },
          },
        },
      },
    },
  };
}

// Expose functions globally for console testing
window.compositionTest = {
  runStressTest,
  testCircularReference,
  addComplexNesting,
  getObservedObject: () => observedObject,
};
