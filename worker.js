// worker.js - Web Worker for heavy processing

// Worker message handler
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    try {
        switch(type) {
            case 'renderTree':
                const renderResult = renderTreeWorker(data.obj, data.options);
                self.postMessage({ 
                    type: 'renderResult', 
                    result: renderResult 
                });
                break;
                
            case 'detectChanges':
                const changeResult = detectChangesWorker(data.oldTree, data.newTree);
                self.postMessage({ 
                    type: 'changesResult', 
                    result: changeResult 
                });
                break;
                
            case 'processLargeObject':
                const processResult = processLargeObjectWorker(data.obj, data.options);
                self.postMessage({ 
                    type: 'processResult', 
                    result: processResult 
                });
                break;
                
            default:
                console.warn('Unknown worker message type:', type);
        }
    } catch (error) {
        self.postMessage({ 
            type: 'error', 
            error: {
                message: error.message,
                stack: error.stack
            }
        });
    }
};

// Render tree in worker thread
function renderTreeWorker(obj, options = {}) {
    const visited = new Set();
    const fragments = new Map();
    const startTime = performance.now();
    
    function serializeForWorker(obj, path = '', depth = 0) {
        // Handle primitives
        if (typeof obj !== 'object' || obj === null) {
            return {
                type: 'primitive',
                value: obj,
                path
            };
        }
        
        // Handle circular references
        if (visited.has(obj)) {
            return {
                type: 'circular',
                path,
                reference: obj.constructor ? obj.constructor.name : 'Object'
            };
        }
        visited.add(obj);
        
        // Handle arrays
        if (Array.isArray(obj)) {
            const items = [];
            for (let i = 0; i < obj.length; i++) {
                const itemPath = path ? `${path}[${i}]` : `[${i}]`;
                items.push(serializeForWorker(obj[i], itemPath, depth + 1));
            }
            return {
                type: 'array',
                path,
                length: obj.length,
                items
            };
        }
        
        // Handle objects
        const properties = [];
        const keys = Object.keys(obj);
        
        for (const key of keys) {
            const propPath = path ? `${path}.${key}` : key;
            try {
                const value = obj[key];
                // Skip functions in worker context
                if (typeof value === 'function') {
                    properties.push({
                        key,
                        value: {
                            type: 'function',
                            name: value.name || 'anonymous',
                            path: propPath
                        }
                    });
                } else {
                    properties.push({
                        key,
                        value: serializeForWorker(value, propPath, depth + 1)
                    });
                }
            } catch (error) {
                properties.push({
                    key,
                    value: {
                        type: 'error',
                        message: error.message,
                        path: propPath
                    }
                });
            }
        }
        
        const fragment = {
            type: 'object',
            path,
            name: obj.constructor ? obj.constructor.name : 'Object',
            depth,
            properties
        };
        
        fragments.set(path, fragment);
        return fragment;
    }
    
    const tree = serializeForWorker(obj);
    const processingTime = performance.now() - startTime;
    
    // Convert to HTML
    const html = convertToHTML(tree);
    
    return {
        tree,
        html,
        fragments: Array.from(fragments.entries()),
        stats: {
            processingTime,
            fragmentCount: fragments.size,
            visitedObjects: visited.size
        }
    };
}

// Convert serialized tree to HTML
function convertToHTML(node, depth = 0) {
    const indent = '  '.repeat(depth);
    
    switch (node.type) {
        case 'primitive':
            return `${indent}<span class="property" data-path="${node.path}">${node.value}</span>\n`;
            
        case 'circular':
            return `${indent}<span class="circular" data-path="${node.path}">* [circular reference to ${node.reference}]</span>\n`;
            
        case 'function':
            return `${indent}<span class="function" data-path="${node.path}">${node.name}()</span>\n`;
            
        case 'error':
            return `${indent}<span class="error" data-path="${node.path}">Error: ${node.message}</span>\n`;
            
        case 'array':
            let arrayHTML = `${indent}<div class="array-node" data-path="${node.path}">Array[${node.length}]\n`;
            for (const item of node.items) {
                arrayHTML += convertToHTML(item, depth + 1);
            }
            arrayHTML += `${indent}</div>\n`;
            return arrayHTML;
            
        case 'object':
            let objectHTML = `${indent}<div class="object-node" data-path="${node.path}">+ ${node.name}\n`;
            for (const prop of node.properties) {
                objectHTML += `${indent}  ${prop.key}: `;
                if (prop.value.type === 'primitive') {
                    objectHTML += `<span class="property" data-path="${prop.value.path}">${prop.value.value}</span>\n`;
                } else {
                    objectHTML += '\n' + convertToHTML(prop.value, depth + 1);
                }
            }
            objectHTML += `${indent}</div>\n`;
            return objectHTML;
            
        default:
            return `${indent}<span class="unknown">Unknown type: ${node.type}</span>\n`;
    }
}

// Detect changes between two object trees
function detectChangesWorker(oldTree, newTree) {
    const changes = [];
    const visited = new Set();
    
    function compareNodes(oldNode, newNode, path = '') {
        if (visited.has(path)) return;
        visited.add(path);
        
        // Handle type changes
        if (!oldNode && newNode) {
            changes.push({
                type: 'add',
                path,
                value: newNode
            });
            return;
        }
        
        if (oldNode && !newNode) {
            changes.push({
                type: 'delete',
                path,
                oldValue: oldNode
            });
            return;
        }
        
        if (oldNode.type !== newNode.type) {
            changes.push({
                type: 'typeChange',
                path,
                oldType: oldNode.type,
                newType: newNode.type,
                oldValue: oldNode,
                newValue: newNode
            });
            return;
        }
        
        // Compare based on type
        switch (newNode.type) {
            case 'primitive':
                if (oldNode.value !== newNode.value) {
                    changes.push({
                        type: 'update',
                        path,
                        oldValue: oldNode.value,
                        newValue: newNode.value
                    });
                }
                break;
                
            case 'object':
                // Compare properties
                const oldProps = new Map(oldNode.properties.map(p => [p.key, p.value]));
                const newProps = new Map(newNode.properties.map(p => [p.key, p.value]));
                
                // Check for added/changed properties
                for (const [key, newProp] of newProps) {
                    const oldProp = oldProps.get(key);
                    const propPath = path ? `${path}.${key}` : key;
                    compareNodes(oldProp, newProp, propPath);
                }
                
                // Check for deleted properties
                for (const [key, oldProp] of oldProps) {
                    if (!newProps.has(key)) {
                        const propPath = path ? `${path}.${key}` : key;
                        compareNodes(oldProp, null, propPath);
                    }
                }
                break;
                
            case 'array':
                // Simple array comparison (could be optimized with diff algorithm)
                if (oldNode.length !== newNode.length) {
                    changes.push({
                        type: 'arrayResize',
                        path,
                        oldLength: oldNode.length,
                        newLength: newNode.length
                    });
                }
                
                const maxLength = Math.max(oldNode.items.length, newNode.items.length);
                for (let i = 0; i < maxLength; i++) {
                    const itemPath = `${path}[${i}]`;
                    compareNodes(
                        oldNode.items[i] || null,
                        newNode.items[i] || null,
                        itemPath
                    );
                }
                break;
        }
    }
    
    compareNodes(oldTree, newTree);
    return changes;
}

// Process large objects with optimization
function processLargeObjectWorker(obj, options = {}) {
    const startTime = performance.now();
    const stats = {
        objectCount: 0,
        primitiveCount: 0,
        functionCount: 0,
        arrayCount: 0,
        circularCount: 0,
        maxDepth: 0
    };
    
    const visited = new WeakSet();
    
    function analyze(obj, depth = 0) {
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        
        if (typeof obj !== 'object' || obj === null) {
            stats.primitiveCount++;
            return;
        }
        
        if (visited.has(obj)) {
            stats.circularCount++;
            return;
        }
        visited.add(obj);
        
        if (Array.isArray(obj)) {
            stats.arrayCount++;
            for (const item of obj) {
                analyze(item, depth + 1);
            }
        } else if (typeof obj === 'function') {
            stats.functionCount++;
        } else {
            stats.objectCount++;
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    analyze(obj[key], depth + 1);
                }
            }
        }
    }
    
    analyze(obj);
    
    const processingTime = performance.now() - startTime;
    
    return {
        stats: {
            ...stats,
            processingTime,
            totalItems: stats.objectCount + stats.primitiveCount + stats.functionCount + stats.arrayCount
        },
        recommendations: generateRecommendations(stats),
        shouldUseWorker: stats.totalItems > 1000 || stats.maxDepth > 10
    };
}

// Generate optimization recommendations
function generateRecommendations(stats) {
    const recommendations = [];
    
    if (stats.maxDepth > 15) {
        recommendations.push({
            type: 'warning',
            message: 'Very deep object nesting detected. Consider flattening structure.',
            metric: `Max depth: ${stats.maxDepth}`
        });
    }
    
    if (stats.circularCount > 5) {
        recommendations.push({
            type: 'info',
            message: 'Multiple circular references found. This is normal but affects rendering performance.',
            metric: `Circular refs: ${stats.circularCount}`
        });
    }
    
    if (stats.totalItems > 5000) {
        recommendations.push({
            type: 'performance',
            message: 'Large object detected. Consider using web worker for processing.',
            metric: `Total items: ${stats.totalItems}`
        });
    }
    
    return recommendations;
}

// Error handling
self.onerror = function(error) {
    self.postMessage({
        type: 'error',
        error: {
            message: error.message,
            filename: error.filename,
            lineno: error.lineno,
            colno: error.colno
        }
    });
};

// Handle unhandled promise rejections
self.onunhandledrejection = function(event) {
    self.postMessage({
        type: 'error',
        error: {
            message: 'Unhandled promise rejection: ' + event.reason,
            type: 'unhandledrejection'
        }
    });
};