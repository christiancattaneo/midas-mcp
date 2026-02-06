/**
 * JSON Fragility Stress Tests
 * 
 * Comprehensive testing of JSON parsing and serialization edge cases:
 * - Trailing commas (objects, arrays, nested)
 * - Undefined values (serialization, deserialization)
 * - NaN, Infinity, -Infinity handling
 * - Leading zeros, malformed numbers
 * - Control characters, escape sequences
 * - Comments, single quotes
 * - Prototype pollution prevention
 * - BigInt, Date, Symbol serialization
 * - Round-trip consistency
 * 
 * Based on RFC 8259 and real-world JSON parsing issues.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as fc from 'fast-check';

// Import state functions that use JSON
import { loadState, saveState, getDefaultState, createHistoryEntry } from '../state/phase.js';
import { loadTracker, saveTracker } from '../tracker.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-json-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.midas'), { recursive: true });
  testDirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of testDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
  testDirs = [];
}

beforeEach(() => {
  testDirs = [];
});

afterEach(() => {
  cleanup();
});

// Helper to test JSON parsing
function parsesSafely(json: string): { success: boolean; error?: string; value?: unknown } {
  try {
    const value = JSON.parse(json);
    return { success: true, value };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// Helper to test JSON serialization
function serializesSafely(value: unknown): { success: boolean; error?: string; json?: string } {
  try {
    const json = JSON.stringify(value);
    return { success: true, json };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ============================================================================
// 1. TRAILING COMMAS
// ============================================================================

describe('Trailing Commas', () => {
  describe('Objects', () => {
    const objectCases = [
      { name: 'simple trailing', json: '{"a":1,}' },
      { name: 'multiple trailing', json: '{"a":1,,}' },
      { name: 'only comma', json: '{,}' },
      { name: 'comma after nested', json: '{"a":{"b":1,},}' },
      { name: 'trailing in nested', json: '{"a":{"b":1,}}' },
      { name: 'multiple properties trailing', json: '{"a":1,"b":2,"c":3,}' },
      { name: 'whitespace before trailing', json: '{"a":1 , }' },
      { name: 'newline before trailing', json: '{"a":1,\n}' },
    ];

    for (const { name, json } of objectCases) {
      it(`should reject object with ${name}`, () => {
        const result = parsesSafely(json);
        
        assert.ok(!result.success, `Should reject: ${json}`);
        // Error message format varies by Node version
        assert.ok(result.error && result.error.length > 0, 
          `Should have error message: ${result.error}`);
      });
    }
  });

  describe('Arrays', () => {
    const arrayCases = [
      { name: 'simple trailing', json: '[1,2,3,]' },
      { name: 'multiple trailing', json: '[1,2,3,,]' },
      { name: 'only comma', json: '[,]' },
      { name: 'holes', json: '[1,,3]' },
      { name: 'multiple holes', json: '[1,,,4]' },
      { name: 'leading comma', json: '[,1,2,3]' },
      { name: 'nested with trailing', json: '[[1,2,],3]' },
      { name: 'deeply nested', json: '[[[1,],],]' },
      { name: 'empty with comma', json: '[,]' },
      { name: 'whitespace around commas', json: '[ , , ]' },
    ];

    for (const { name, json } of arrayCases) {
      it(`should reject array with ${name}`, () => {
        const result = parsesSafely(json);
        
        assert.ok(!result.success, `Should reject: ${json}`);
      });
    }
  });

  describe('Mixed', () => {
    it('should reject nested object/array with trailing commas', () => {
      const cases = [
        '{"arr":[1,2,],}',
        '[{"a":1,}]',
        '{"nested":{"deep":[1,2,],},}',
      ];
      
      for (const json of cases) {
        const result = parsesSafely(json);
        assert.ok(!result.success, `Should reject: ${json}`);
      }
    });
  });

  describe('State Recovery', () => {
    it('should recover when state file has trailing commas', () => {
      const dir = createTestDir('trailing-comma-state');
      const stateFile = join(dir, '.midas', 'state.json');
      
      // Write invalid JSON with trailing comma
      writeFileSync(stateFile, '{"current":{"phase":"IDLE"},}');
      
      const state = loadState(dir);
      
      // Should return default state, not crash
      assert.ok(state !== null);
      assert.ok(state.current.phase === 'IDLE');
    });
  });
});

// ============================================================================
// 2. UNDEFINED VALUES
// ============================================================================

describe('Undefined Values', () => {
  describe('Serialization', () => {
    it('should omit undefined properties', () => {
      const obj = { a: 1, b: undefined, c: 3 };
      const result = serializesSafely(obj);
      
      assert.ok(result.success);
      assert.ok(!result.json?.includes('undefined'));
      
      const parsed = JSON.parse(result.json!);
      assert.strictEqual(parsed.a, 1);
      assert.ok(!('b' in parsed), 'undefined property should be omitted');
      assert.strictEqual(parsed.c, 3);
    });

    it('should convert undefined in array to null', () => {
      const arr = [1, undefined, 3];
      const result = serializesSafely(arr);
      
      assert.ok(result.success);
      
      const parsed = JSON.parse(result.json!);
      assert.strictEqual(parsed[0], 1);
      assert.strictEqual(parsed[1], null);  // undefined becomes null
      assert.strictEqual(parsed[2], 3);
    });

    it('should handle deeply nested undefined', () => {
      const obj = {
        a: {
          b: {
            c: undefined,
            d: 1,
          },
          e: undefined,
        },
        f: [1, undefined, { g: undefined }],
      };
      
      const result = serializesSafely(obj);
      assert.ok(result.success);
      
      const parsed = JSON.parse(result.json!);
      assert.ok(!('c' in parsed.a.b));
      assert.ok(!('e' in parsed.a));
      assert.strictEqual(parsed.f[1], null);
      assert.ok(!('g' in parsed.f[2]));
    });
  });

  describe('Parsing', () => {
    it('should reject literal undefined', () => {
      const result = parsesSafely('{"a":undefined}');
      
      assert.ok(!result.success);
    });

    it('should handle null correctly', () => {
      const result = parsesSafely('{"a":null}');
      
      assert.ok(result.success);
      assert.strictEqual((result.value as any).a, null);
    });
  });

  describe('State handling', () => {
    it('should handle state with null values gracefully', () => {
      const dir = createTestDir('null-values');
      const stateFile = join(dir, '.midas', 'state.json');
      
      writeFileSync(stateFile, '{"current":null,"history":null,"docs":null}');
      
      const state = loadState(dir);
      
      // Should merge with defaults
      assert.ok(state.current !== null);
      assert.ok(Array.isArray(state.history));
      assert.ok(state.docs !== null);
    });
  });
});

// ============================================================================
// 3. NaN, INFINITY, -INFINITY
// ============================================================================

describe('NaN and Infinity', () => {
  describe('Serialization', () => {
    it('should serialize NaN as null', () => {
      const obj = { num: NaN };
      const result = serializesSafely(obj);
      
      assert.ok(result.success);
      const parsed = JSON.parse(result.json!);
      assert.strictEqual(parsed.num, null);
    });

    it('should serialize Infinity as null', () => {
      const obj = { num: Infinity };
      const result = serializesSafely(obj);
      
      assert.ok(result.success);
      const parsed = JSON.parse(result.json!);
      assert.strictEqual(parsed.num, null);
    });

    it('should serialize -Infinity as null', () => {
      const obj = { num: -Infinity };
      const result = serializesSafely(obj);
      
      assert.ok(result.success);
      const parsed = JSON.parse(result.json!);
      assert.strictEqual(parsed.num, null);
    });

    it('should serialize array with special numbers', () => {
      const arr = [1, NaN, Infinity, -Infinity, 2];
      const result = serializesSafely(arr);
      
      assert.ok(result.success);
      const parsed = JSON.parse(result.json!);
      assert.deepStrictEqual(parsed, [1, null, null, null, 2]);
    });
  });

  describe('Parsing', () => {
    const invalidLiterals = [
      { name: 'NaN', json: '{"num":NaN}' },
      { name: 'Infinity', json: '{"num":Infinity}' },
      { name: '-Infinity', json: '{"num":-Infinity}' },
      { name: '+Infinity', json: '{"num":+Infinity}' },
      { name: 'nan lowercase', json: '{"num":nan}' },
      { name: 'infinity lowercase', json: '{"num":infinity}' },
    ];

    for (const { name, json } of invalidLiterals) {
      it(`should reject literal ${name}`, () => {
        const result = parsesSafely(json);
        
        assert.ok(!result.success, `Should reject: ${json}`);
      });
    }

    it('should accept string representations', () => {
      const cases = [
        '{"num":"NaN"}',
        '{"num":"Infinity"}',
        '{"num":"-Infinity"}',
      ];
      
      for (const json of cases) {
        const result = parsesSafely(json);
        assert.ok(result.success, `Should accept string: ${json}`);
      }
    });
  });

  describe('State handling', () => {
    it('should handle state where numbers became null', () => {
      const dir = createTestDir('null-numbers');
      const state = getDefaultState();
      
      // Simulate what happens if special numbers were in state
      (state as any).someNumber = null;  // As if NaN was serialized
      
      saveState(dir, state);
      const loaded = loadState(dir);
      
      assert.ok(loaded.current.phase === 'IDLE');
    });
  });
});

// ============================================================================
// 4. MALFORMED NUMBERS
// ============================================================================

describe('Malformed Numbers', () => {
  const malformedNumbers = [
    { name: 'leading zero', json: '{"num":01}' },
    { name: 'leading zeros', json: '{"num":007}' },
    { name: 'trailing decimal', json: '{"num":1.}' },
    { name: 'leading decimal', json: '{"num":.5}' },
    { name: 'plus sign', json: '{"num":+5}' },
    { name: 'double negative', json: '{"num":--5}' },
    { name: 'multiple decimals', json: '{"num":1.2.3}' },
    { name: 'exponent only', json: '{"num":e5}' },
    { name: 'malformed exponent', json: '{"num":1e}' },
    { name: 'double exponent', json: '{"num":1e2e3}' },
    { name: 'hex notation', json: '{"num":0xFF}' },
    { name: 'octal notation', json: '{"num":0o77}' },
    { name: 'binary notation', json: '{"num":0b11}' },
    { name: 'underscore separator', json: '{"num":1_000}' },
  ];

  for (const { name, json } of malformedNumbers) {
    it(`should reject ${name}`, () => {
      const result = parsesSafely(json);
      
      assert.ok(!result.success, `Should reject: ${json}`);
    });
  }

  describe('Valid numbers', () => {
    const validNumbers = [
      { name: 'integer', json: '{"num":42}', expected: 42 },
      { name: 'negative', json: '{"num":-42}', expected: -42 },
      { name: 'decimal', json: '{"num":3.14}', expected: 3.14 },
      { name: 'negative decimal', json: '{"num":-3.14}', expected: -3.14 },
      { name: 'exponent', json: '{"num":1e5}', expected: 1e5 },
      { name: 'negative exponent', json: '{"num":1e-5}', expected: 1e-5 },
      { name: 'positive exponent', json: '{"num":1e+5}', expected: 1e5 },
      { name: 'zero', json: '{"num":0}', expected: 0 },
      { name: 'negative zero', json: '{"num":-0}', expected: -0 },
      { name: 'large number', json: '{"num":9007199254740991}', expected: 9007199254740991 },
    ];

    for (const { name, json, expected } of validNumbers) {
      it(`should accept ${name}`, () => {
        const result = parsesSafely(json);
        
        assert.ok(result.success, `Should accept: ${json}`);
        assert.strictEqual((result.value as any).num, expected);
      });
    }
  });

  describe('Number precision', () => {
    it('should lose precision for very large integers', () => {
      // Beyond Number.MAX_SAFE_INTEGER
      // Using a number that definitely loses precision
      const bigNum = '9007199254740999';
      const json = `{"num":${bigNum}}`;
      const result = parsesSafely(json);
      
      assert.ok(result.success);
      // The parsed number won't equal the string representation due to precision loss
      const parsed = (result.value as any).num;
      // Check that precision was indeed lost by comparing string representations
      assert.notStrictEqual(String(parsed), bigNum, 'Should lose precision');
    });

    it('should handle MAX_SAFE_INTEGER exactly', () => {
      const json = `{"num":${Number.MAX_SAFE_INTEGER}}`;
      const result = parsesSafely(json);
      
      assert.ok(result.success);
      assert.strictEqual((result.value as any).num, Number.MAX_SAFE_INTEGER);
    });
  });
});

// ============================================================================
// 5. CONTROL CHARACTERS AND ESCAPES
// ============================================================================

describe('Control Characters and Escapes', () => {
  describe('Invalid control characters', () => {
    it('should reject unescaped control characters in strings', () => {
      // Control characters 0x00-0x1F must be escaped
      for (let i = 0; i < 32; i++) {
        if (i === 9 || i === 10 || i === 13) continue; // Tab, LF, CR tested separately
        
        const json = `{"str":"a${String.fromCharCode(i)}b"}`;
        const result = parsesSafely(json);
        
        assert.ok(!result.success, `Should reject control char 0x${i.toString(16).padStart(2, '0')}`);
      }
    });

    it('should reject unescaped newline in string', () => {
      const json = '{"str":"line1\nline2"}';
      const result = parsesSafely(json);
      
      assert.ok(!result.success);
    });

    it('should reject unescaped tab in string', () => {
      const json = '{"str":"col1\tcol2"}';
      const result = parsesSafely(json);
      
      assert.ok(!result.success);
    });
  });

  describe('Valid escape sequences', () => {
    const validEscapes = [
      { name: 'backslash', json: '{"str":"a\\\\b"}', expected: 'a\\b' },
      { name: 'quote', json: '{"str":"a\\"b"}', expected: 'a"b' },
      { name: 'slash', json: '{"str":"a\\/b"}', expected: 'a/b' },
      { name: 'backspace', json: '{"str":"a\\bb"}', expected: 'a\bb' },
      { name: 'form feed', json: '{"str":"a\\fb"}', expected: 'a\fb' },
      { name: 'newline', json: '{"str":"a\\nb"}', expected: 'a\nb' },
      { name: 'carriage return', json: '{"str":"a\\rb"}', expected: 'a\rb' },
      { name: 'tab', json: '{"str":"a\\tb"}', expected: 'a\tb' },
      { name: 'unicode 4 digit', json: '{"str":"\\u0041"}', expected: 'A' },
      { name: 'unicode null', json: '{"str":"\\u0000"}', expected: '\x00' },
    ];

    for (const { name, json, expected } of validEscapes) {
      it(`should accept ${name}`, () => {
        const result = parsesSafely(json);
        
        assert.ok(result.success, `Should accept: ${json}`);
        assert.strictEqual((result.value as any).str, expected);
      });
    }
  });

  describe('Invalid escape sequences', () => {
    const invalidEscapes = [
      { name: 'invalid char', json: '{"str":"\\x41"}' },  // Not valid JSON escape
      { name: 'single char', json: '{"str":"\\a"}' },
      { name: 'short unicode', json: '{"str":"\\u41"}' },
      { name: 'incomplete unicode', json: '{"str":"\\u004"}' },
      { name: 'invalid unicode', json: '{"str":"\\uXXXX"}' },
    ];

    for (const { name, json } of invalidEscapes) {
      it(`should reject ${name}`, () => {
        const result = parsesSafely(json);
        
        assert.ok(!result.success, `Should reject: ${json}`);
      });
    }
  });
});

// ============================================================================
// 6. COMMENTS
// ============================================================================

describe('Comments', () => {
  const commentCases = [
    { name: 'line comment', json: '{"a":1}// comment' },
    { name: 'block comment', json: '{"a":1/* comment */}' },
    { name: 'comment before', json: '// comment\n{"a":1}' },
    { name: 'comment in object', json: '{"a":1,/* comment */"b":2}' },
    { name: 'hash comment', json: '{"a":1} # comment' },
  ];

  for (const { name, json } of commentCases) {
    it(`should reject ${name}`, () => {
      const result = parsesSafely(json);
      
      assert.ok(!result.success, `Should reject: ${json}`);
    });
  }
});

// ============================================================================
// 7. SINGLE QUOTES
// ============================================================================

describe('Single Quotes', () => {
  const singleQuoteCases = [
    { name: 'single quote key', json: "{'a':1}" },
    { name: 'single quote value', json: '{"a":\'hello\'}' },
    { name: 'mixed quotes', json: "{\"a\":'hello'}" },
    { name: 'single quote both', json: "{'a':'hello'}" },
  ];

  for (const { name, json } of singleQuoteCases) {
    it(`should reject ${name}`, () => {
      const result = parsesSafely(json);
      
      assert.ok(!result.success, `Should reject: ${json}`);
    });
  }
});

// ============================================================================
// 8. PROTOTYPE POLLUTION PREVENTION
// ============================================================================

describe('Prototype Pollution Prevention', () => {
  it('should not pollute Object.prototype via __proto__', () => {
    const json = '{"__proto__":{"polluted":"yes"}}';
    const result = parsesSafely(json);
    
    assert.ok(result.success);
    
    // Check that Object.prototype was not polluted
    assert.ok(!({} as any).polluted);
  });

  it('should not pollute via constructor', () => {
    const json = '{"constructor":{"prototype":{"polluted":"yes"}}}';
    const result = parsesSafely(json);
    
    assert.ok(result.success);
    assert.ok(!({} as any).polluted);
  });

  it('should handle __proto__ as regular property', () => {
    const json = '{"__proto__":"value"}';
    const result = parsesSafely(json);
    
    assert.ok(result.success);
    // __proto__ might be accessible or not depending on how we access it
    // But prototype should not be polluted
    assert.ok(!({} as any).__proto__?.polluted);
  });

  it('should not allow nested prototype pollution', () => {
    const json = '{"a":{"__proto__":{"polluted":"deep"}}}';
    const result = parsesSafely(json);
    
    assert.ok(result.success);
    assert.ok(!({} as any).polluted);
  });

  describe('State file prototype safety', () => {
    it('should safely load state with __proto__ field', () => {
      const dir = createTestDir('proto-state');
      const stateFile = join(dir, '.midas', 'state.json');
      
      writeFileSync(stateFile, '{"current":{"phase":"IDLE"},"__proto__":{"hacked":"yes"}}');
      
      const state = loadState(dir);
      
      assert.ok(state.current.phase === 'IDLE');
      assert.ok(!({} as any).hacked);
    });
  });
});

// ============================================================================
// 9. SPECIAL TYPES (BigInt, Date, Symbol, Function)
// ============================================================================

describe('Special Types Serialization', () => {
  it('should throw when serializing BigInt', () => {
    const obj = { num: BigInt(9007199254740993) };
    const result = serializesSafely(obj);
    
    assert.ok(!result.success);
    assert.ok(result.error?.includes('BigInt'));
  });

  it('should serialize Date as ISO string', () => {
    const date = new Date('2025-01-17T00:00:00.000Z');
    const obj = { date };
    const result = serializesSafely(obj);
    
    assert.ok(result.success);
    const parsed = JSON.parse(result.json!);
    assert.strictEqual(parsed.date, '2025-01-17T00:00:00.000Z');
  });

  it('should omit Symbol properties', () => {
    const sym = Symbol('test');
    const obj = { [sym]: 'value', normal: 'kept' };
    const result = serializesSafely(obj);
    
    assert.ok(result.success);
    const parsed = JSON.parse(result.json!);
    assert.ok(!Object.keys(parsed).includes('Symbol(test)'));
    assert.strictEqual(parsed.normal, 'kept');
  });

  it('should omit function properties', () => {
    const obj = { fn: () => 'hello', normal: 'kept' };
    const result = serializesSafely(obj);
    
    assert.ok(result.success);
    const parsed = JSON.parse(result.json!);
    assert.ok(!('fn' in parsed));
    assert.strictEqual(parsed.normal, 'kept');
  });

  it('should handle circular references with error', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    
    const result = serializesSafely(obj);
    
    assert.ok(!result.success);
    assert.ok(result.error?.includes('circular') || result.error?.includes('Converting'));
  });
});

// ============================================================================
// 10. WHITESPACE AND FORMATTING
// ============================================================================

describe('Whitespace and Formatting', () => {
  const validWhitespace = [
    { name: 'no whitespace', json: '{"a":1}' },
    { name: 'spaces', json: '{ "a" : 1 }' },
    { name: 'tabs', json: '{\t"a"\t:\t1\t}' },
    { name: 'newlines', json: '{\n"a"\n:\n1\n}' },
    { name: 'mixed', json: '{\n  "a": 1,\n  "b": 2\n}' },
    { name: 'leading whitespace', json: '   {"a":1}' },
    { name: 'trailing whitespace', json: '{"a":1}   ' },
    { name: 'CRLF', json: '{\r\n"a": 1\r\n}' },
  ];

  for (const { name, json } of validWhitespace) {
    it(`should accept ${name}`, () => {
      const result = parsesSafely(json);
      
      assert.ok(result.success, `Should accept: ${name}`);
      assert.strictEqual((result.value as any).a, 1);
    });
  }

  describe('Unicode line separators', () => {
    it('should handle U+2028 line separator in string', () => {
      // Line separator must be escaped in JSON strings
      const json = '{"str":"a\\u2028b"}';
      const result = parsesSafely(json);
      
      assert.ok(result.success);
      assert.ok((result.value as any).str.includes('\u2028'));
    });

    it('should handle U+2029 paragraph separator in string', () => {
      const json = '{"str":"a\\u2029b"}';
      const result = parsesSafely(json);
      
      assert.ok(result.success);
      assert.ok((result.value as any).str.includes('\u2029'));
    });
  });
});

// ============================================================================
// 11. EMPTY AND MINIMAL JSON
// ============================================================================

describe('Empty and Minimal JSON', () => {
  const minimalCases = [
    { name: 'empty object', json: '{}', type: 'object' },
    { name: 'empty array', json: '[]', type: 'array' },
    { name: 'null', json: 'null', type: 'null' },
    { name: 'true', json: 'true', type: 'boolean' },
    { name: 'false', json: 'false', type: 'boolean' },
    { name: 'zero', json: '0', type: 'number' },
    { name: 'empty string', json: '""', type: 'string' },
    { name: 'number', json: '42', type: 'number' },
    { name: 'string', json: '"hello"', type: 'string' },
  ];

  for (const { name, json, type } of minimalCases) {
    it(`should accept ${name}`, () => {
      const result = parsesSafely(json);
      
      assert.ok(result.success, `Should accept: ${json}`);
    });
  }

  const invalidMinimal = [
    { name: 'empty', json: '' },
    { name: 'whitespace only', json: '   ' },
    { name: 'undefined literal', json: 'undefined' },
    { name: 'unquoted string', json: 'hello' },
    { name: 'just comma', json: ',' },
    { name: 'just colon', json: ':' },
    { name: 'just bracket', json: '{' },
  ];

  for (const { name, json } of invalidMinimal) {
    it(`should reject ${name}`, () => {
      const result = parsesSafely(json);
      
      assert.ok(!result.success, `Should reject: ${json}`);
    });
  }
});

// ============================================================================
// 12. DEEP NESTING
// ============================================================================

describe('Deep Nesting', () => {
  it('should handle deeply nested objects', () => {
    let json = '{"a":';
    for (let i = 0; i < 100; i++) {
      json += '{"b":';
    }
    json += '1';
    for (let i = 0; i < 100; i++) {
      json += '}';
    }
    json += '}';
    
    const result = parsesSafely(json);
    
    // May or may not succeed depending on parser limits
    // But should not crash
    assert.ok(typeof result.success === 'boolean');
  });

  it('should handle deeply nested arrays', () => {
    let json = '';
    for (let i = 0; i < 100; i++) {
      json += '[';
    }
    json += '1';
    for (let i = 0; i < 100; i++) {
      json += ']';
    }
    
    const result = parsesSafely(json);
    
    assert.ok(typeof result.success === 'boolean');
  });
});

// ============================================================================
// 13. ROUND-TRIP CONSISTENCY
// ============================================================================

describe('Round-Trip Consistency', () => {
  it('should preserve data through parse-stringify-parse', () => {
    const original = {
      str: 'hello world',
      num: 42,
      float: 3.14,
      bool: true,
      nil: null,
      arr: [1, 2, 3],
      obj: { nested: 'value' },
    };
    
    const json1 = JSON.stringify(original);
    const parsed1 = JSON.parse(json1);
    const json2 = JSON.stringify(parsed1);
    const parsed2 = JSON.parse(json2);
    
    assert.deepStrictEqual(parsed1, parsed2);
    assert.strictEqual(json1, json2);
  });

  it('should handle state round-trip', () => {
    const dir = createTestDir('roundtrip');
    
    const original = getDefaultState();
    original.history.push(createHistoryEntry({ phase: 'BUILD', step: 'IMPLEMENT' }));
    original.docs.prd = true;
    
    saveState(dir, original);
    const loaded = loadState(dir);
    
    assert.strictEqual(loaded.current.phase, original.current.phase);
    assert.strictEqual(loaded.docs.prd, true);
    assert.ok(loaded.history.length >= 1);
  });

  it('should handle tracker round-trip', () => {
    const dir = createTestDir('tracker-roundtrip');
    
    // Load default tracker (creates if not exists)
    const tracker = loadTracker(dir);
    tracker.errorMemory.push({
      id: `test-${Date.now()}`,
      error: 'Test error',
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      resolved: false,
      fixAttempts: [],
    });
    
    saveTracker(dir, tracker);
    const loaded = loadTracker(dir);
    
    assert.ok(loaded.errorMemory.length >= 1);
    assert.strictEqual(loaded.errorMemory[0].error, 'Test error');
  });
});

// ============================================================================
// 14. PROPERTY-BASED TESTS
// ============================================================================

describe('Property-Based Tests', () => {
  it('valid JSON should round-trip consistently', () => {
    fc.assert(
      fc.property(
        fc.jsonValue(),
        (value) => {
          const json1 = JSON.stringify(value);
          const parsed1 = JSON.parse(json1);
          const json2 = JSON.stringify(parsed1);
          return json1 === json2;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('JSON.stringify should never throw on safe values', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.double({ noNaN: true, noDefaultInfinity: true }),
          fc.boolean(),
          fc.constant(null)
        ),
        (value) => {
          try {
            JSON.stringify(value);
            return true;
          } catch {
            return false;
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('JSON.parse should never crash on any string', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        try {
          JSON.parse(input);
          return true;  // Parsed successfully
        } catch {
          return true;  // Failed gracefully
        }
      }),
      { numRuns: 500 }
    );
  });
});

// ============================================================================
// 15. PERFORMANCE
// ============================================================================

describe('Performance', () => {
  it('should parse large JSON quickly', () => {
    const large = { arr: [] as number[] };
    for (let i = 0; i < 10000; i++) {
      large.arr.push(i);
    }
    const json = JSON.stringify(large);
    
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      JSON.parse(json);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 parses of 10k array: ${elapsed}ms`);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should stringify large JSON quickly', () => {
    const large = { arr: [] as number[] };
    for (let i = 0; i < 10000; i++) {
      large.arr.push(i);
    }
    
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      JSON.stringify(large);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 stringifies of 10k array: ${elapsed}ms`);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should handle many small JSON operations', () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      const obj = { a: i, b: `value${i}` };
      const json = JSON.stringify(obj);
      JSON.parse(json);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 10k small round-trips: ${elapsed}ms`);
    assert.ok(elapsed < 3000, `Too slow: ${elapsed}ms`);
  });
});
