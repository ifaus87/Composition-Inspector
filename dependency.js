// Add the Dependency class
class Dependency {
  static #dependencies = new WeakMap();

  static for(instance) {
    if (!this.#dependencies.has(instance)) {
      this.#dependencies.set(instance, new Map());
    }
    return {
      exists: (ComponentClass) => {
        const deps = this.#dependencies.get(instance);
        return deps.has(ComponentClass);
      },
      register: (ComponentClass) => {
        const deps = this.#dependencies.get(instance);
        if (!deps.has(ComponentClass)) {
          const componentInstance = new ComponentClass();
          const componentName = ComponentClass.name.toLowerCase();
          
          // Add the component instance to the observed object
          instance[componentName] = componentInstance;
          
          // Track the dependency
          deps.set(ComponentClass, componentInstance);
          
          console.log(`Registered ${ComponentClass.name} component`);
          return componentInstance;
        }
        return deps.get(ComponentClass);
      },
      get: (ComponentClass) => {
        const deps = this.#dependencies.get(instance);
        return deps.get(ComponentClass);
      }
    };
  }
}