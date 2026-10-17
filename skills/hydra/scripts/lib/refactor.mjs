import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const GURU_URL = 'https://refactoring.guru';

// Full Refactoring.Guru Catalog of Code Smells (22 smells in 5 families + 2 complexity smells)
export const SMELLS_CATALOG = {
  'long-method': {
    name: 'Long Method',
    family: 'Bloaters',
    threshold: '>35 lines',
    description: 'A method contains too many lines of code. Generally, any method longer than 10-15 lines should raise questions.',
    refactorings: ['Extract Method', 'Replace Temp with Query', 'Introduce Parameter Object', 'Preserve Whole Object', 'Replace Method with Method Object'],
    url: `${GURU_URL}/smells/long-method`,
  },
  'large-class': {
    name: 'Large Class',
    family: 'Bloaters',
    threshold: '>250 lines or >12 methods',
    description: 'A class contains too many fields, methods, or lines of code, violating the Single Responsibility Principle.',
    refactorings: ['Extract Class', 'Extract Subclass', 'Extract Interface', 'Duplicate Observed Data'],
    url: `${GURU_URL}/smells/large-class`,
  },
  'primitive-obsession': {
    name: 'Primitive Obsession',
    family: 'Bloaters',
    threshold: 'Using primitives instead of small objects for simple tasks (currency, ranges, phone numbers)',
    description: 'Use of primitives instead of small domain objects (such as ranges, currency, coordinates).',
    refactorings: ['Replace Data Value with Object', 'Introduce Parameter Object', 'Replace Type Code with Class', 'Replace Type Code with Subclasses', 'Replace Type Code with State/Strategy'],
    url: `${GURU_URL}/smells/primitive-obsession`,
  },
  'long-parameter-list': {
    name: 'Long Parameter List',
    family: 'Bloaters',
    threshold: '>4 parameters',
    description: 'More than three or four parameters for a method make it hard to understand and prone to bugs.',
    refactorings: ['Replace Parameter with Method Call', 'Preserve Whole Object', 'Introduce Parameter Object', 'Remove Setting Method'],
    url: `${GURU_URL}/smells/long-parameter-list`,
  },
  'data-clumps': {
    name: 'Data Clumps',
    family: 'Bloaters',
    threshold: '>=3 identical parameters appearing together across functions',
    description: 'Different parts of the code contain identical groups of variables (such as parameters for connecting to a database).',
    refactorings: ['Extract Class', 'Introduce Parameter Object', 'Preserve Whole Object'],
    url: `${GURU_URL}/smells/data-clumps`,
  },
  'switch-statements': {
    name: 'Switch Statements',
    family: 'Object-Orientation Abusers',
    threshold: 'Complex switch or chained if-else with >=4 branches',
    description: 'Complex switch operator or sequence of if statements checking type codes or object states.',
    refactorings: ['Replace Conditional with Polymorphism', 'Replace Type Code with Subclasses', 'Replace Type Code with State/Strategy', 'Replace Parameter with Explicit Methods', 'Introduce Null Object'],
    url: `${GURU_URL}/smells/switch-statements`,
  },
  'temporary-field': {
    name: 'Temporary Field',
    family: 'Object-Orientation Abusers',
    threshold: 'Fields only set/used under specific circumstances',
    description: 'Temporary fields get values (and so are needed by objects) only under certain circumstances.',
    refactorings: ['Extract Class', 'Replace Method with Method Object', 'Introduce Null Object'],
    url: `${GURU_URL}/smells/temporary-field`,
  },
  'refused-bequest': {
    name: 'Refused Bequest',
    family: 'Object-Orientation Abusers',
    threshold: 'Subclass inherits methods it ignores or throws unsupported exceptions on',
    description: 'If a subclass uses only some of the methods and properties inherited from its parents.',
    refactorings: ['Replace Inheritance with Delegation', 'Extract Superclass'],
    url: `${GURU_URL}/smells/refused-bequest`,
  },
  'alternative-classes': {
    name: 'Alternative Classes with Different Interfaces',
    family: 'Object-Orientation Abusers',
    threshold: 'Classes performing identical tasks with different method signatures',
    description: 'Two classes perform identical functions but have different method names.',
    refactorings: ['Rename Method', 'Move Method', 'Extract Superclass'],
    url: `${GURU_URL}/smells/alternative-classes-with-different-interfaces`,
  },
  'divergent-change': {
    name: 'Divergent Change',
    family: 'Change Preventers',
    threshold: 'One class modified for multiple unrelated requirements (SRP violation)',
    description: 'You find yourself having to change many unrelated methods when you make changes to a class.',
    refactorings: ['Extract Class', 'Extract Subclass', 'Extract Superclass'],
    url: `${GURU_URL}/smells/divergent-change`,
  },
  'shotgun-surgery': {
    name: 'Shotgun Surgery',
    family: 'Change Preventers',
    threshold: 'A single change forces edits across multiple classes/files',
    description: 'Making any modifications requires that you make many small changes to many different classes.',
    refactorings: ['Move Method', 'Move Field', 'Inline Class'],
    url: `${GURU_URL}/smells/shotgun-surgery`,
  },
  'parallel-inheritance': {
    name: 'Parallel Inheritance Hierarchies',
    family: 'Change Preventers',
    threshold: 'Adding a subclass to one hierarchy requires adding a subclass to another',
    description: 'Whenever you create a subclass for a class, you find yourself needing to create a subclass for another class.',
    refactorings: ['Move Method', 'Move Field'],
    url: `${GURU_URL}/smells/parallel-inheritance-hierarchies`,
  },
  'comments': {
    name: 'Comments as Deodorant',
    family: 'Dispensables',
    threshold: 'Explanatory comments placed above large, cryptic code blocks',
    description: 'A method is filled with explanatory comments because the code itself is unclear.',
    refactorings: ['Extract Variable', 'Extract Method', 'Rename Method', 'Introduce Assertion'],
    url: `${GURU_URL}/smells/comments`,
  },
  'duplicate-code': {
    name: 'Duplicate Code',
    family: 'Dispensables',
    threshold: '>=4 identical non-trivial lines repeated in code',
    description: 'Two code fragments look almost identical, violating the DRY (Don\'t Repeat Yourself) principle.',
    refactorings: ['Extract Method', 'Pull Up Method', 'Form Template Method', 'Substitute Algorithm', 'Extract Class'],
    url: `${GURU_URL}/smells/duplicate-code`,
  },
  'lazy-class': {
    name: 'Lazy Class',
    family: 'Dispensables',
    threshold: 'Class doing almost nothing',
    description: 'A class that does not do enough to earn its keep should be eliminated.',
    refactorings: ['Inline Class', 'Collapse Hierarchy'],
    url: `${GURU_URL}/smells/lazy-class`,
  },
  'data-class': {
    name: 'Data Class',
    family: 'Dispensables',
    threshold: 'Class with only fields/getters/setters and zero behavior',
    description: 'A class that refers only to fields and crude methods for accessing them (getters and setters).',
    refactorings: ['Move Method', 'Encapsulate Field', 'Encapsulate Collection', 'Remove Setting Method'],
    url: `${GURU_URL}/smells/data-class`,
  },
  'dead-code': {
    name: 'Dead Code',
    family: 'Dispensables',
    threshold: 'Unreachable code following return/throw/break or unused functions',
    description: 'A variable, parameter, field, method or class is no longer used (usually because it is obsolete).',
    refactorings: ['Inline Class', 'Collapse Hierarchy', 'Remove Parameter', 'Remove Dead Code'],
    url: `${GURU_URL}/smells/dead-code`,
  },
  'speculative-generality': {
    name: 'Speculative Generality',
    family: 'Dispensables',
    threshold: 'Unused abstract classes, interfaces or unused hooks created for "future use"',
    description: 'There is an unused class, method, field or parameter created to support anticipated future features.',
    refactorings: ['Collapse Hierarchy', 'Inline Class', 'Inline Method', 'Remove Parameter'],
    url: `${GURU_URL}/smells/speculative-generality`,
  },
  'feature-envy': {
    name: 'Feature Envy',
    family: 'Couplers',
    threshold: 'A method accesses the data of another object more than its own',
    description: 'A method accesses the data of another object more than its own data.',
    refactorings: ['Move Method', 'Extract Method'],
    url: `${GURU_URL}/smells/feature-envy`,
  },
  'inappropriate-intimacy': {
    name: 'Inappropriate Intimacy',
    family: 'Couplers',
    threshold: 'One class uses the internal fields and methods of another',
    description: 'One class uses the internal fields and methods of another class, violating encapsulation.',
    refactorings: ['Move Method', 'Move Field', 'Change Bidirectional Association to Unidirectional', 'Hide Delegate'],
    url: `${GURU_URL}/smells/inappropriate-intimacy`,
  },
  'message-chains': {
    name: 'Message Chains',
    family: 'Couplers',
    threshold: '>=3 consecutive method/property invocations (a.b().c().d())',
    description: 'In code you see a series of calls resembling $a->b()->c()->d(), violating the Law of Demeter.',
    refactorings: ['Hide Delegate', 'Extract Method', 'Move Method'],
    url: `${GURU_URL}/smells/message-chains`,
  },
  'middle-man': {
    name: 'Middle Man',
    family: 'Couplers',
    threshold: 'Class where most methods simply delegate to another class',
    description: 'If a class performs only one action, that of delegating work to another class.',
    refactorings: ['Remove Middle Man', 'Inline Method', 'Replace Delegation with Inheritance'],
    url: `${GURU_URL}/smells/middle-man`,
  },
  'incomplete-library-class': {
    name: 'Incomplete Library Class',
    family: 'Couplers',
    threshold: 'Third-party library class lacking a required feature',
    description: 'A vendor library stops meeting user needs and you cannot change its source.',
    refactorings: ['Introduce Foreign Method', 'Introduce Local Extension'],
    url: `${GURU_URL}/smells/incomplete-library-class`,
  },
  'deep-nesting': {
    name: 'Deep Nesting',
    family: 'Complexity',
    threshold: 'Indentation depth >=4 levels',
    description: 'Deeply nested control structures (if/for/while/try) severely impede readability and maintainability.',
    refactorings: ['Replace Nested Conditional with Guard Clauses', 'Decompose Conditional', 'Extract Method'],
    url: `${GURU_URL}/replace-nested-conditional-with-guard-clauses`,
  },
  'magic-number': {
    name: 'Magic Number',
    family: 'Organizing Data',
    threshold: 'Unexplained numeric literals in code logic',
    description: 'A numeric literal in code whose meaning is not obvious from context.',
    refactorings: ['Replace Magic Number with Symbolic Constant'],
    url: `${GURU_URL}/replace-magic-number-with-symbolic-constant`,
  },
};

// Full Refactoring.Guru Catalog of Design Patterns (All 22 GoF patterns across 3 categories)
export const PATTERNS_CATALOG = {
  // Creational (5)
  'factory-method': {
    name: 'Factory Method',
    category: 'Creational',
    intent: 'Defines an interface for creating an object, but lets subclasses decide which class to instantiate.',
    applicability: 'Use when you don\'t know beforehand the exact types and dependencies of the objects your code should work with, or when you want to provide users with a way to extend library components.',
    smellsAddressed: ['switch-statements', 'primitive-obsession'],
    url: `${GURU_URL}/design-patterns/factory-method`,
  },
  'abstract-factory': {
    name: 'Abstract Factory',
    category: 'Creational',
    intent: 'Lets you produce families of related or dependent objects without specifying their concrete classes.',
    applicability: 'Use when your code needs to work with various families of related products, but you don\'t want it to depend on the concrete classes of those products.',
    smellsAddressed: ['divergent-change', 'switch-statements'],
    url: `${GURU_URL}/design-patterns/abstract-factory`,
  },
  'builder': {
    name: 'Builder',
    category: 'Creational',
    intent: 'Lets you construct complex objects step by step, producing different types and representations of an object using the same construction code.',
    applicability: 'Use to get rid of a "telescoping constructor" with 5+ parameters, or when construction involves complex multi-step processes.',
    smellsAddressed: ['long-parameter-list', 'large-class', 'primitive-obsession'],
    url: `${GURU_URL}/design-patterns/builder`,
  },
  'prototype': {
    name: 'Prototype',
    category: 'Creational',
    intent: 'Lets you copy existing objects without making your code dependent on their classes.',
    applicability: 'Use when your code shouldn\'t depend on the concrete classes of objects that you need to copy, or to reduce subclassing for object creation.',
    smellsAddressed: ['duplicate-code'],
    url: `${GURU_URL}/design-patterns/prototype`,
  },
  'singleton': {
    name: 'Singleton',
    category: 'Creational',
    intent: 'Lets you ensure that a class has only one instance, while providing a global access point to this instance.',
    applicability: 'Use when a class in your program should have just a single instance available to all clients (e.g. single database connection, configuration registry).',
    smellsAddressed: [],
    url: `${GURU_URL}/design-patterns/singleton`,
  },
  // Structural (7)
  'adapter': {
    name: 'Adapter',
    category: 'Structural',
    intent: 'Allows objects with incompatible interfaces to collaborate.',
    applicability: 'Use when you want to use some existing class, but its interface isn\'t compatible with the rest of your code, or when integrating 3rd party libraries.',
    smellsAddressed: ['alternative-classes', 'incomplete-library-class'],
    url: `${GURU_URL}/design-patterns/adapter`,
  },
  'bridge': {
    name: 'Bridge',
    category: 'Structural',
    intent: 'Lets you split a large class or a set of closely related classes into two separate hierarchies—abstraction and implementation—which can be developed independently.',
    applicability: 'Use when you want to divide and organize a monolithic class that has several variants of some functionality (such as cross-platform GUI/renderers).',
    smellsAddressed: ['parallel-inheritance', 'large-class'],
    url: `${GURU_URL}/design-patterns/bridge`,
  },
  'composite': {
    name: 'Composite',
    category: 'Structural',
    intent: 'Lets you compose objects into tree structures and then work with these structures as if they were individual objects.',
    applicability: 'Use when you need to implement a tree-like object structure (such as nested document nodes, UI widgets, or file hierarchies).',
    smellsAddressed: ['switch-statements', 'duplicate-code'],
    url: `${GURU_URL}/design-patterns/composite`,
  },
  'decorator': {
    name: 'Decorator',
    category: 'Structural',
    intent: 'Lets you attach new behaviors to objects by placing these objects inside special wrapper objects that contain the behaviors.',
    applicability: 'Use when you need to be able to assign extra behaviors to objects at runtime without breaking the code that uses these objects, or when extending by inheritance is awkward.',
    smellsAddressed: ['large-class', 'parallel-inheritance'],
    url: `${GURU_URL}/design-patterns/decorator`,
  },
  'facade': {
    name: 'Facade',
    category: 'Structural',
    intent: 'Provides a simplified interface to a library, a framework, or any other complex set of classes.',
    applicability: 'Use when you need to have a limited but straightforward interface to a complex subsystem with dozens of interrelated classes.',
    smellsAddressed: ['shotgun-surgery', 'inappropriate-intimacy'],
    url: `${GURU_URL}/design-patterns/facade`,
  },
  'flyweight': {
    name: 'Flyweight',
    category: 'Structural',
    intent: 'Lets you fit more objects into the available amount of RAM by sharing common parts of state between multiple objects instead of keeping all of the data in each object.',
    applicability: 'Use only when your program must spawn a huge number of similar objects which barely fit into available RAM.',
    smellsAddressed: ['large-class'],
    url: `${GURU_URL}/design-patterns/flyweight`,
  },
  'proxy': {
    name: 'Proxy',
    category: 'Structural',
    intent: 'Lets you provide a substitute or placeholder for another object. A proxy controls access to the original object, allowing you to perform something either before or after the request reaches the original object.',
    applicability: 'Use for lazy initialization (virtual proxy), access control (protection proxy), local execution of a remote service (remote proxy), or logging/caching.',
    smellsAddressed: ['middle-man'],
    url: `${GURU_URL}/design-patterns/proxy`,
  },
  // Behavioral (10)
  'chain-of-responsibility': {
    name: 'Chain of Responsibility',
    category: 'Behavioral',
    intent: 'Lets you pass requests along a chain of handlers. Upon receiving a request, each handler decides either to process the request or to pass it to the next handler in the chain.',
    applicability: 'Use when your program is expected to process different kinds of requests in various ways, but the exact types of requests and their sequences are unknown beforehand (middleware, filters).',
    smellsAddressed: ['deep-nesting', 'switch-statements', 'long-method'],
    url: `${GURU_URL}/design-patterns/chain-of-responsibility`,
  },
  'command': {
    name: 'Command',
    category: 'Behavioral',
    intent: 'Turns a request into a stand-alone object that contains all information about the request. This transformation lets you pass requests as method arguments, delay or queue a request\'s execution, and support undoable operations.',
    applicability: 'Use when you want to parameterize objects with operations, queue operations, schedule their execution, or support undo/redo.',
    smellsAddressed: ['long-method', 'large-class'],
    url: `${GURU_URL}/design-patterns/command`,
  },
  'iterator': {
    name: 'Iterator',
    category: 'Behavioral',
    intent: 'Lets you traverse elements of a collection without exposing its underlying representation (list, stack, tree, etc.).',
    applicability: 'Use when your collection has a complex data structure under the hood, but you want to hide its complexity from clients.',
    smellsAddressed: ['feature-envy'],
    url: `${GURU_URL}/design-patterns/iterator`,
  },
  'mediator': {
    name: 'Mediator',
    category: 'Behavioral',
    intent: 'Lets you reduce chaotic dependencies between objects. The pattern restricts direct communications between the objects and forces them to collaborate only via a mediator object.',
    applicability: 'Use when it\'s hard to change some of the classes because they are tightly coupled to a dozen of other classes.',
    smellsAddressed: ['inappropriate-intimacy', 'shotgun-surgery'],
    url: `${GURU_URL}/design-patterns/mediator`,
  },
  'memento': {
    name: 'Memento',
    category: 'Behavioral',
    intent: 'Lets you save and restore the previous state of an object without revealing the details of its implementation.',
    applicability: 'Use when you want to produce snapshots of the object\'s state to be able to restore a previous state of the object (e.g. undo, transactions).',
    smellsAddressed: ['inappropriate-intimacy'],
    url: `${GURU_URL}/design-patterns/memento`,
  },
  'observer': {
    name: 'Observer',
    category: 'Behavioral',
    intent: 'Lets you define a subscription mechanism to notify multiple objects about any events that happen to the object they\'re observing.',
    applicability: 'Use when changes to the state of one object may require changing other objects, and the actual set of objects is unknown beforehand or changes dynamically.',
    smellsAddressed: ['divergent-change', 'shotgun-surgery'],
    url: `${GURU_URL}/design-patterns/observer`,
  },
  'state': {
    name: 'State',
    category: 'Behavioral',
    intent: 'Lets an object alter its behavior when its internal state changes. It appears as if the object changed its class.',
    applicability: 'Use when you have an object that behaves differently depending on its current state, the number of states is enormous, and the state-specific code changes frequently.',
    smellsAddressed: ['switch-statements', 'temporary-field'],
    url: `${GURU_URL}/design-patterns/state`,
  },
  'strategy': {
    name: 'Strategy',
    category: 'Behavioral',
    intent: 'Lets you define a family of algorithms, put each of them into a separate class, and make their objects interchangeable.',
    applicability: 'Use when you want to use different variants of an algorithm within an object and be able to switch from one algorithm to another during runtime.',
    smellsAddressed: ['switch-statements', 'long-method', 'duplicate-code'],
    url: `${GURU_URL}/design-patterns/strategy`,
  },
  'template-method': {
    name: 'Template Method',
    category: 'Behavioral',
    intent: 'Defines the skeleton of an algorithm in the superclass but lets subclasses override specific steps of the algorithm without changing its structure.',
    applicability: 'Use when you want to let clients extend only particular steps of an algorithm, but not the whole algorithm or its structure.',
    smellsAddressed: ['duplicate-code'],
    url: `${GURU_URL}/design-patterns/template-method`,
  },
  'visitor': {
    name: 'Visitor',
    category: 'Behavioral',
    intent: 'Lets you separate algorithms from the objects on which they operate.',
    applicability: 'Use when you need to perform an operation on all elements of a complex object structure (e.g. an AST tree or object graph).',
    smellsAddressed: ['divergent-change'],
    url: `${GURU_URL}/design-patterns/visitor`,
  },
};

// Patterns for functions, methods and classes across JS, TS, Python, Go, Rust, Java
const FUNCTION_PATTERNS = [
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/,
  /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/,
  /^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/,
  /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/,
  /^func\s+(?:\([^)]*\)\s+)?([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/,
  /^\s*(?:public|private|protected|static|final|native|synchronized|abstract|\s)*\s+[a-zA-Z0-9_<>[\], ]+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:throws\s+[a-zA-Z0-9_, ]+)?\s*\{/,
];

const CLASS_PATTERNS = [
  /^(?:export\s+(?:default\s+)?)?class\s+([a-zA-Z0-9_$]+)/,
  /^class\s+([a-zA-Z0-9_]+)\s*(?:\([^)]*\))?:/,
  /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([a-zA-Z0-9_]+)/,
  /^type\s+([a-zA-Z0-9_]+)\s+struct/,
];

/**
 * Scan source code string for Refactoring.Guru code smells.
 */
export function scanCode(content, filename = 'code.ts', options = {}) {
  const maxMethodLines = options.maxMethodLines ?? 35;
  const maxClassLines = options.maxClassLines ?? 250;
  const maxParams = options.maxParams ?? 4;
  const maxNesting = options.maxNesting ?? 3;

  const lines = content.split('\n');
  const findings = [];
  const paramClumps = new Map();

  // 1. Structure discovery: locate functions, classes
  const functions = [];
  const classes = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    for (const pat of CLASS_PATTERNS) {
      const m = pat.exec(trimmed);
      if (m) {
        classes.push({ name: m[1], startLine: i + 1, indent: line.search(/\S/) });
        break;
      }
    }

    for (const pat of FUNCTION_PATTERNS) {
      const m = pat.exec(trimmed);
      if (m) {
        const name = m[1];
        const paramsRaw = m[2] ? m[2].trim() : '';
        const params = paramsRaw
          ? paramsRaw.split(',').map(p => p.trim().split(/[\s:=]/)[0].replace(/^[*&]/, '')).filter(Boolean)
          : [];
        functions.push({ name, params, startLine: i + 1, indent: line.search(/\S/) });
        break;
      }
    }
  }

  // Calculate function boundaries and analyze them
  for (let idx = 0; idx < functions.length; idx++) {
    const fn = functions[idx];
    const nextFn = functions[idx + 1];
    let endLine = lines.length;
    if (nextFn && nextFn.indent <= fn.indent) {
      endLine = nextFn.startLine - 1;
    } else {
      for (let j = fn.startLine; j < lines.length; j++) {
        if (/^\s*[}\]]\s*;?\s*$/.test(lines[j]) && lines[j].search(/\S/) <= fn.indent) {
          endLine = j + 1;
          break;
        }
      }
    }
    fn.endLine = Math.min(lines.length, Math.max(fn.startLine, endLine));
    fn.lineCount = fn.endLine - fn.startLine + 1;

    // Smell: Long Method
    if (fn.lineCount > maxMethodLines) {
      findings.push({
        smell: 'long-method',
        name: SMELLS_CATALOG['long-method'].name,
        family: SMELLS_CATALOG['long-method'].family,
        symbol: fn.name,
        line: fn.startLine,
        endLine: fn.endLine,
        metric: `${fn.lineCount} lines (limit: ${maxMethodLines})`,
        recipe: 'Extract Method: break into smaller focused helper functions.',
        url: SMELLS_CATALOG['long-method'].url,
      });
    }

    // Smell: Long Parameter List
    if (fn.params.length > maxParams) {
      findings.push({
        smell: 'long-parameter-list',
        name: SMELLS_CATALOG['long-parameter-list'].name,
        family: SMELLS_CATALOG['long-parameter-list'].family,
        symbol: fn.name,
        line: fn.startLine,
        metric: `${fn.params.length} parameters (${fn.params.join(', ')})`,
        recipe: 'Introduce Parameter Object: group related parameters into a dedicated options object/struct.',
        url: SMELLS_CATALOG['long-parameter-list'].url,
      });
    }

    // Record parameter clump candidate (if >= 3 params)
    if (fn.params.length >= 3) {
      const key = fn.params.slice().sort().join(',');
      if (!paramClumps.has(key)) paramClumps.set(key, []);
      paramClumps.get(key).push({ fnName: fn.name, line: fn.startLine, params: fn.params });
    }
  }

  // Calculate class boundaries
  for (let idx = 0; idx < classes.length; idx++) {
    const cls = classes[idx];
    const nextCls = classes[idx + 1];
    let endLine = nextCls ? nextCls.startLine - 1 : lines.length;
    for (let j = cls.startLine; j < lines.length; j++) {
      if (/^\s*[}\]]\s*;?\s*$/.test(lines[j]) && lines[j].search(/\S/) <= cls.indent) {
        endLine = j + 1;
        break;
      }
    }
    cls.endLine = Math.min(lines.length, Math.max(cls.startLine, endLine));
    cls.lineCount = cls.endLine - cls.startLine + 1;

    const methods = functions.filter(f => f.startLine >= cls.startLine && f.endLine <= cls.endLine);
    if (cls.lineCount > maxClassLines || methods.length > 12) {
      findings.push({
        smell: 'large-class',
        name: SMELLS_CATALOG['large-class'].name,
        family: SMELLS_CATALOG['large-class'].family,
        symbol: cls.name,
        line: cls.startLine,
        endLine: cls.endLine,
        metric: `${cls.lineCount} lines, ${methods.length} methods (limit: ${maxClassLines} lines)`,
        recipe: 'Extract Class: partition responsibilities and move cohesive methods to a new class.',
        url: SMELLS_CATALOG['large-class'].url,
      });
    }
  }

  // Smell: Data Clumps (same >=3 parameters appearing in multiple functions)
  for (const [key, occurrences] of paramClumps.entries()) {
    if (occurrences.length >= 2) {
      const sample = occurrences[0];
      findings.push({
        smell: 'data-clumps',
        name: SMELLS_CATALOG['data-clumps'].name,
        family: SMELLS_CATALOG['data-clumps'].family,
        symbol: occurrences.map(o => o.fnName).join(', '),
        line: sample.line,
        metric: `Identical parameter cluster [${sample.params.join(', ')}] across ${occurrences.length} functions`,
        recipe: 'Extract Class / Introduce Parameter Object: wrap clumped fields into a unified class or record.',
        url: SMELLS_CATALOG['data-clumps'].url,
      });
    }
  }

  // 2. Line-by-line inspection (Nesting, Switch Statements, Dead Code, Magic Numbers, Message Chains)
  let switchCaseCount = 0;
  let switchStartLine = -1;
  let nestingStart = -1;
  let maxDepthInBlock = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
      if (nestingStart !== -1) {
        const endLine = lineNum - 1;
        findings.push({
          smell: 'deep-nesting',
          name: SMELLS_CATALOG['deep-nesting'].name,
          family: SMELLS_CATALOG['deep-nesting'].family,
          line: nestingStart,
          endLine: endLine > nestingStart ? endLine : undefined,
          metric: `Indentation depth ${maxDepthInBlock} across ${endLine - nestingStart + 1} lines (limit: ${maxNesting})`,
          recipe: 'Replace Nested Conditional with Guard Clauses: return early or decompose sub-conditions.',
          url: SMELLS_CATALOG['deep-nesting'].url,
        });
        nestingStart = -1;
      }
      continue;
    }

    // Indentation depth check (supports 2-space, 4-space and tabs)
    const leadingMatch = line.match(/^([ \t]*)/);
    const leading = leadingMatch ? leadingMatch[1] : '';
    let spaceCount = 0;
    let tabCount = 0;
    for (const ch of leading) {
      if (ch === '\t') tabCount++;
      else spaceCount++;
    }
    const depthFromSpaces = Math.floor(spaceCount / 2);
    const depth = tabCount + depthFromSpaces;

    if (depth > maxNesting && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      if (nestingStart === -1) {
        nestingStart = lineNum;
        maxDepthInBlock = depth;
      } else {
        maxDepthInBlock = Math.max(maxDepthInBlock, depth);
      }
    } else {
      if (nestingStart !== -1) {
        const endLine = lineNum - 1;
        findings.push({
          smell: 'deep-nesting',
          name: SMELLS_CATALOG['deep-nesting'].name,
          family: SMELLS_CATALOG['deep-nesting'].family,
          line: nestingStart,
          endLine: endLine > nestingStart ? endLine : undefined,
          metric: `Indentation depth ${maxDepthInBlock} across ${endLine - nestingStart + 1} lines (limit: ${maxNesting})`,
          recipe: 'Replace Nested Conditional with Guard Clauses: return early or decompose sub-conditions.',
          url: SMELLS_CATALOG['deep-nesting'].url,
        });
        nestingStart = -1;
      }
    }

    // Switch statements & chained if-else
    if (/^\s*switch\s*\(/.test(line)) {
      switchStartLine = lineNum;
      switchCaseCount = 0;
    } else if (switchStartLine > 0) {
      if (/^\s*(?:case\s+[^:]+|default)\s*:/.test(line)) {
        switchCaseCount++;
      }
      if (/^\s*\}\s*$/.test(line)) {
        if (switchCaseCount >= 4) {
          findings.push({
            smell: 'switch-statements',
            name: SMELLS_CATALOG['switch-statements'].name,
            family: SMELLS_CATALOG['switch-statements'].family,
            line: switchStartLine,
            endLine: lineNum,
            metric: `Switch with ${switchCaseCount} branches`,
            recipe: 'Replace Conditional with Polymorphism / Strategy Pattern: delegate execution to polymorphic classes.',
            url: SMELLS_CATALOG['switch-statements'].url,
          });
        }
        switchStartLine = -1;
      }
    }

    // Dead Code detection: single-line terminal statements not opening a multiline block
    if (/^\s*(?:return\b[^;{([,?:+\-=>]*;|throw\s+new\b[^;{([,?:+\-=>]*;|break;|continue;)\s*$/.test(trimmed)) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && !/^[}\])]/.test(nextLine) && !/^(?:case\b|default\b|\/\/|\/\*)/.test(nextLine)) {
        findings.push({
          smell: 'dead-code',
          name: SMELLS_CATALOG['dead-code'].name,
          family: SMELLS_CATALOG['dead-code'].family,
          line: lineNum + 1,
          metric: `Unreachable code immediately following "${trimmed.slice(0, 30)}"`,
          recipe: 'Remove Dead Code: delete unreachable statements.',
          url: SMELLS_CATALOG['dead-code'].url,
        });
      }
    }

    // Message Chains: >= 3 method or property hops (e.g., a.b.c.d() or obj.getA().getB().getC())
    if (/[a-zA-Z0-9_$]+\.[a-zA-Z0-9_$]+(?:\([^)]*\))?\.[a-zA-Z0-9_$]+(?:\([^)]*\))?\.[a-zA-Z0-9_$]+/.test(trimmed)) {
      if (!trimmed.startsWith('import ') && !trimmed.startsWith('export ') && !trimmed.includes('console.log')) {
        findings.push({
          smell: 'message-chains',
          name: SMELLS_CATALOG['message-chains'].name,
          family: SMELLS_CATALOG['message-chains'].family,
          line: lineNum,
          metric: `Long invocation chain: "${trimmed.slice(0, 60)}"`,
          recipe: 'Hide Delegate: encapsulate deep navigation behind a direct method on the immediate neighbor.',
          url: SMELLS_CATALOG['message-chains'].url,
        });
      }
    }

    // Magic Numbers (unexplained raw literals > 2 that are not in constants/configs)
    const magicMatch = /(?:[=!<>+\-*/,%&|]\s*|\b(?:if|while|for|return)\b[^(]*\([^)]*|\(\s*)\b([3-9]\d{1,5}|\d{3,6})\b/.exec(trimmed);
    if (magicMatch && !trimmed.startsWith('const ') && !trimmed.startsWith('let ') && !/status|port|error|code|200|404|500/i.test(trimmed)) {
      findings.push({
        smell: 'magic-number',
        name: SMELLS_CATALOG['magic-number'].name,
        family: SMELLS_CATALOG['magic-number'].family,
        line: lineNum,
        metric: `Unexplained numeric literal: ${magicMatch[1]}`,
        recipe: 'Replace Magic Number with Symbolic Constant: define a descriptive CONSTANT.',
        url: SMELLS_CATALOG['magic-number'].url,
      });
    }
  }

  if (nestingStart !== -1) {
    const endLine = lines.length;
    findings.push({
      smell: 'deep-nesting',
      name: SMELLS_CATALOG['deep-nesting'].name,
      family: SMELLS_CATALOG['deep-nesting'].family,
      line: nestingStart,
      endLine: endLine > nestingStart ? endLine : undefined,
      metric: `Indentation depth ${maxDepthInBlock} across ${endLine - nestingStart + 1} lines (limit: ${maxNesting})`,
      recipe: 'Replace Nested Conditional with Guard Clauses: return early or decompose sub-conditions.',
      url: SMELLS_CATALOG['deep-nesting'].url,
    });
  }

  // 3. Duplicate code detection (groups of >=4 contiguous non-trivial lines repeated)
  const lineBlocks = new Map();
  const BLOCK_SIZE = 4;
  for (let i = 0; i <= lines.length - BLOCK_SIZE; i++) {
    const slice = lines.slice(i, i + BLOCK_SIZE).map(l => l.trim()).filter(Boolean);
    if (slice.length === BLOCK_SIZE && slice.every(l => l.length > 5 && !l.startsWith('//') && !l.startsWith('/*') && l !== '{' && l !== '}')) {
      const key = slice.join(' ## ');
      if (!lineBlocks.has(key)) lineBlocks.set(key, []);
      lineBlocks.get(key).push(i + 1);
    }
  }

  const reportedDuplicates = new Set();
  for (const [key, occurrences] of lineBlocks.entries()) {
    if (occurrences.length >= 2) {
      const first = occurrences[0];
      const second = occurrences[1];
      if (second >= first + BLOCK_SIZE && !reportedDuplicates.has(first)) {
        for (let b = 0; b < BLOCK_SIZE; b++) reportedDuplicates.add(first + b);
        findings.push({
          smell: 'duplicate-code',
          name: SMELLS_CATALOG['duplicate-code'].name,
          family: SMELLS_CATALOG['duplicate-code'].family,
          line: first,
          metric: `${BLOCK_SIZE}-line identical code block repeated at line ${second}`,
          recipe: 'Extract Method: extract the duplicated code into a shared method.',
          url: SMELLS_CATALOG['duplicate-code'].url,
        });
      }
    }
  }

  // Sort findings by line number
  findings.sort((a, b) => (a.line || 0) - (b.line || 0));

  return {
    filename,
    totalLines: lines.length,
    smellsFound: findings.length,
    findings,
  };
}

/**
 * Scan a single file from disk.
 */
export function scanFile(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = readFileSync(resolved, 'utf8');
  return scanCode(content, filePath, options);
}

/**
 * Scan a directory recursively (ignoring node_modules, .git, etc.).
 */
export function scanDirectory(dirPath, options = {}) {
  const resolved = path.resolve(dirPath);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.cs']);
  const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.hydra', '.next', 'target', 'vendor', '__pycache__']);

  const reports = [];

  function walk(current) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SUPPORTED_EXTS.has(ext)) {
          const fullPath = path.join(current, entry.name);
          try {
            const rel = path.relative(resolved, fullPath);
            const report = scanFile(fullPath, options);
            if (report.smellsFound > 0) {
              report.filename = rel;
              reports.push(report);
            }
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }
  }

  walk(resolved);

  const totalSmells = reports.reduce((sum, r) => sum + r.smellsFound, 0);

  return {
    directory: dirPath,
    filesWithSmells: reports.length,
    totalSmells,
    reports,
  };
}

/**
 * Scan unified git diff (e.g. from `git diff` or `git diff --staged`) for introduced code smells.
 */
export function scanDiff(diffText) {
  const fileDiffs = [];
  const lines = diffText.split('\n');
  let currentFile = null;
  let addedLines = [];
  let currentLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      if (currentFile && addedLines.length) {
        fileDiffs.push({ file: currentFile, code: addedLines.map(l => l.text).join('\n') });
      }
      currentFile = line.split(' ')[2]?.replace(/^a\//, '') || 'unknown';
      addedLines = [];
    } else if (line.startsWith('@@ ')) {
      const m = /\+([0-9]+)/.exec(line);
      currentLineNum = m ? parseInt(m[1], 10) : 0;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push({ num: currentLineNum, text: line.slice(1) });
      currentLineNum++;
    } else if (!line.startsWith('-')) {
      currentLineNum++;
    }
  }

  if (currentFile && addedLines.length) {
    fileDiffs.push({ file: currentFile, code: addedLines.map(l => l.text).join('\n') });
  }

  const reports = [];
  for (const { file, code } of fileDiffs) {
    const report = scanCode(code, file);
    if (report.smellsFound > 0) {
      reports.push(report);
    }
  }

  return {
    totalFilesChecked: fileDiffs.length,
    filesWithSmells: reports.length,
    reports,
  };
}

/**
 * Generate a Refactoring.Guru step-by-step recipe for a specific symbol or line range.
 */
export function generateRecipe(content, target = {}) {
  const lines = content.split('\n');
  let { symbol, startLine, endLine } = target;

  if (symbol && (!startLine || !endLine)) {
    const term = symbol.toLowerCase().trim();
    for (let i = 0; i < lines.length; i++) {
      for (const pat of [...FUNCTION_PATTERNS, ...CLASS_PATTERNS]) {
        const m = pat.exec(lines[i].trim());
        if (m && m[1].toLowerCase() === term) {
          startLine = i + 1;
          for (let j = i + 1; j < lines.length; j++) {
            if (/^\s*[}\]]\s*;?\s*$/.test(lines[j]) && lines[j].search(/\S/) <= lines[i].search(/\S/)) {
              endLine = j + 1;
              break;
            }
          }
          endLine = endLine || Math.min(lines.length, startLine + 40);
          break;
        }
      }
      if (startLine) break;
    }
  }

  startLine = Math.max(1, startLine || 1);
  endLine = Math.min(lines.length, endLine || lines.length);

  const slice = lines.slice(startLine - 1, endLine).join('\n');
  const scan = scanCode(slice, 'slice.ts');

  const steps = [];

  const hasNesting = scan.findings.some(f => f.smell === 'deep-nesting');
  const hasLongMethod = scan.findings.some(f => f.smell === 'long-method') || (endLine - startLine > 30);
  const hasSwitch = scan.findings.some(f => f.smell === 'switch-statements');
  const hasLongParams = scan.findings.some(f => f.smell === 'long-parameter-list');
  const hasMagicNumbers = scan.findings.some(f => f.smell === 'magic-number');

  if (hasNesting) {
    steps.push({
      step: steps.length + 1,
      technique: 'Replace Nested Conditional with Guard Clauses',
      url: `${GURU_URL}/replace-nested-conditional-with-guard-clauses`,
      goal: 'Flatten nested control structures by returning or continuing early on boundary/error conditions.',
      instructions: [
        'Identify boundary conditions (null checks, empty lists, validation failures).',
        'Invert the nested "if (valid) { ...lots of code... }" into "if (!valid) return;".',
        'Place guard clauses at the very beginning of the function body.',
      ],
    });
  }

  if (hasLongParams) {
    steps.push({
      step: steps.length + 1,
      technique: 'Introduce Parameter Object',
      url: `${GURU_URL}/introduce-parameter-object`,
      goal: 'Replace 4+ parameters with a single cohesive options record or domain object.',
      instructions: [
        'Declare a new interface/type or class grouping these parameters.',
        'Update callers to pass an object literal containing these fields.',
        'Access properties via the parameter object inside the function body.',
      ],
    });
  }

  if (hasLongMethod) {
    steps.push({
      step: steps.length + 1,
      technique: 'Extract Method',
      url: `${GURU_URL}/extract-method`,
      goal: 'Break long monolithic method into smaller, single-purpose helper functions.',
      instructions: [
        'Group cohesive contiguous statements that perform one sub-task.',
        'Check which local variables are read and written by this chunk.',
        'Extract the chunk into a private/helper function named after what it does, not how it does it.',
        'Pass required local variables as arguments and return any modified value.',
      ],
    });
  }

  if (hasSwitch) {
    steps.push({
      step: steps.length + 1,
      technique: 'Replace Conditional with Polymorphism / Strategy Pattern',
      url: `${GURU_URL}/replace-conditional-with-polymorphism`,
      goal: 'Eliminate fragile switch/if-else ladders by distributing branch behavior into polymorphic classes or handler strategies.',
      instructions: [
        'Define a common interface or strategy function with the execution signature.',
        'Create a separate implementation/strategy class for each branch case.',
        'Use a dictionary/map lookup or factory to resolve the strategy at runtime.',
      ],
    });
  }

  if (hasMagicNumbers) {
    steps.push({
      step: steps.length + 1,
      technique: 'Replace Magic Number with Symbolic Constant',
      url: `${GURU_URL}/replace-magic-number-with-symbolic-constant`,
      goal: 'Replace raw numbers with meaningful named constants.',
      instructions: [
        'Declare a const at the top of the file/class describing what the number represents.',
        'Replace all occurrences of the literal number with the constant name.',
      ],
    });
  }

  if (steps.length === 0) {
    steps.push({
      step: 1,
      technique: 'Clean Code Check',
      url: `${GURU_URL}/refactoring/what-is-refactoring`,
      goal: 'The selected code is relatively compact with no high-severity code smells detected.',
      instructions: ['Verify test coverage before making architectural adjustments.'],
    });
  }

  return {
    symbol: symbol || `Lines ${startLine}-${endLine}`,
    startLine,
    endLine,
    totalLines: endLine - startLine + 1,
    smellsDetected: scan.findings.map(f => f.name),
    steps,
  };
}

/**
 * Design Pattern Advisor: query by pattern name, smell, or architectural problem.
 */
export function advisePattern(query = '', codeSnippet = '') {
  const q = query.toLowerCase().trim();

  // 1. Direct Pattern Lookup
  for (const [id, pat] of Object.entries(PATTERNS_CATALOG)) {
    if (id === q || pat.name.toLowerCase() === q || id.replace(/-/g, '') === q.replace(/[\s-_]/g, '')) {
      return {
        matched: 'direct',
        pattern: pat.name,
        category: pat.category,
        intent: pat.intent,
        applicability: pat.applicability,
        smellsAddressed: pat.smellsAddressed.map(s => SMELLS_CATALOG[s]?.name || s),
        url: pat.url,
      };
    }
  }

  // 2. Query Search across Intent, Applicability, and Smells
  const results = [];
  for (const [id, pat] of Object.entries(PATTERNS_CATALOG)) {
    let score = 0;
    if (q) {
      const words = q.split(/\s+/).filter(w => w.length >= 3);
      for (const w of words) {
        if (pat.name.toLowerCase().includes(w)) score += 5;
        if (pat.intent.toLowerCase().includes(w)) score += 3;
        if (pat.applicability.toLowerCase().includes(w)) score += 2;
        if (pat.smellsAddressed.some(s => s.includes(w))) score += 4;
      }
    }
    if (codeSnippet) {
      if (id === 'builder' && (codeSnippet.split(',').length > 5 || /constructor\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)/.test(codeSnippet))) score += 4;
      if (id === 'strategy' && (/switch\s*\(/.test(codeSnippet) || /if\s*\(.*===\s*['"][a-z]+['"]\)/i.test(codeSnippet))) score += 4;
      if (id === 'state' && /status|state|phase/i.test(codeSnippet) && /switch|case/i.test(codeSnippet)) score += 5;
      if (id === 'observer' && /subscribe|listener|emit|event|notify/i.test(codeSnippet)) score += 4;
      if (id === 'facade' && /import|require/.test(codeSnippet) && codeSnippet.split('\n').length > 50) score += 3;
      if (id === 'chain-of-responsibility' && /middleware|next\(\)|handler/i.test(codeSnippet)) score += 4;
    }

    if (score > 0) {
      results.push({ id, ...pat, score });
    }
  }

  results.sort((a, b) => b.score - a.score);

  if (results.length > 0) {
    const top = results[0];
    return {
      matched: 'search',
      query,
      pattern: top.name,
      category: top.category,
      intent: top.intent,
      applicability: top.applicability,
      smellsAddressed: top.smellsAddressed.map(s => SMELLS_CATALOG[s]?.name || s),
      otherMatches: results.slice(1, 4).map(r => ({ name: r.name, category: r.category })),
      url: top.url,
    };
  }

  return {
    matched: 'general',
    query,
    recommendation: 'Refactoring.Guru Design Patterns: Creational (Factory, Builder, Singleton), Structural (Adapter, Facade, Decorator, Proxy), Behavioral (Strategy, Observer, State, Command).',
    url: `${GURU_URL}/design-patterns/catalog`,
  };
}

/**
 * Format Smell Report as human-readable text.
 */
export function formatSmellReport(report) {
  if (!report.smellsFound) {
    return `✔ ${report.filename}: No high-severity code smells detected (clean code).`;
  }
  const lines = [`[hydra smell] ${report.filename} (${report.totalLines} lines, ${report.smellsFound} smells)`];
  for (const f of report.findings) {
    const loc = f.endLine ? `L${f.line}-L${f.endLine}` : `L${f.line}`;
    lines.push(`  • [${loc}] ${f.name} (${f.family}): ${f.metric}`);
    lines.push(`    ↳ ${f.recipe}`);
  }
  return lines.join('\n');
}

/**
 * Format Recipe as human-readable text.
 */
export function formatRecipe(rec) {
  const lines = [
    `[hydra refactor] Recipe for ${rec.symbol} (${rec.totalLines} lines, lines ${rec.startLine}-${rec.endLine})`,
  ];
  if (rec.smellsDetected.length) {
    lines.push(`  Detected Smells: ${rec.smellsDetected.join(', ')}`);
  }
  for (const s of rec.steps) {
    lines.push(`\n  Step ${s.step}: ${s.technique}`);
    lines.push(`  Goal: ${s.goal}`);
    for (const inst of s.instructions) {
      lines.push(`    - ${inst}`);
    }
    lines.push(`  Ref: ${s.url}`);
  }
  return lines.join('\n');
}

/**
 * Format Design Pattern Advisor output as human-readable text.
 */
export function formatPattern(adv) {
  if (adv.matched === 'general') {
    return `[hydra design] ${adv.recommendation}\nRef: ${adv.url}`;
  }
  const lines = [
    `[hydra design] ${adv.pattern} Pattern (${adv.category})`,
    `  Intent: ${adv.intent}`,
    `  When to use: ${adv.applicability}`,
  ];
  if (adv.smellsAddressed?.length) {
    lines.push(`  Addresses Smells: ${adv.smellsAddressed.join(', ')}`);
  }
  if (adv.otherMatches?.length) {
    lines.push(`  Other possibilities: ${adv.otherMatches.map(m => `${m.name} (${m.category})`).join(', ')}`);
  }
  lines.push(`  Guide: ${adv.url}`);
  return lines.join('\n');
}
