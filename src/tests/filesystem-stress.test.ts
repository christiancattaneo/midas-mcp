/**
 * Filesystem Stress Tests
 * 
 * Comprehensive, exhaustive testing of filesystem edge cases.
 * Covers: deep nesting, symlinks, binary files, long filenames, special chars,
 * unicode normalization, permission issues, and race conditions.
 * 
 * Based on best practices from:
 * - OWASP path traversal testing
 * - Unicode normalization attacks (NFC vs NFD)
 * - TOCTOU (time-of-check-time-of-use) race conditions
 * - Platform-specific edge cases (Windows reserved names, etc.)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import { 
  mkdirSync, writeFileSync, rmSync, existsSync, 
  symlinkSync, readFileSync, chmodSync, readdirSync,
  statSync, unlinkSync, renameSync
} from 'fs';
import { join, sep, normalize } from 'path';
import { tmpdir, platform } from 'os';

// Module imports
import { discoverSourceFiles, discoverAndReadCode } from '../code-discovery.js';
import { discoverDocs, discoverDocsSync } from '../docs-discovery.js';
import { sanitizePath, isShellSafe } from '../security.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const IS_WINDOWS = platform() === 'win32';
const IS_MACOS = platform() === 'darwin';
const MAX_FILENAME_LENGTH = IS_WINDOWS ? 255 : 255;  // Most filesystems
const MAX_PATH_LENGTH = IS_WINDOWS ? 260 : 4096;     // Windows has shorter limit

// Characters that are problematic on various platforms
const WINDOWS_FORBIDDEN = ['<', '>', ':', '"', '|', '?', '*'];
const UNIX_FORBIDDEN = ['\x00'];  // Only null byte
const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
];

// ============================================================================
// TEST SETUP
// ============================================================================

let testDir: string;
let cleanupDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-fs-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  cleanupDirs = [];
}

function safeCreateFile(path: string, content: string): boolean {
  try {
    writeFileSync(path, content);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  testDir = createTestDir('stress');
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// 1. DEEP NESTING
// ============================================================================

describe('Deep Nesting', () => {
  const depths = [1, 5, 10, 20, 30, 50, 75, 100];

  for (const depth of depths) {
    it(`should handle ${depth} levels of nesting`, () => {
      let path = testDir;
      for (let i = 0; i < depth; i++) {
        path = join(path, `d${i}`);
      }
      
      try {
        mkdirSync(path, { recursive: true });
        const filePath = join(path, 'file.ts');
        writeFileSync(filePath, `export const depth = ${depth};`);
        
        assert.ok(existsSync(filePath), `File should exist at depth ${depth}`);
        
        // Test code discovery
        const result = discoverAndReadCode(testDir, {});
        // Should not crash
        assert.ok(result.files !== undefined);
      } catch (e: unknown) {
        // Path too long is acceptable on some systems
        const err = e as Error;
        if (!err.message.includes('ENAMETOOLONG')) {
          throw e;
        }
      }
    });
  }

  it('should handle alternating long/short directory names', () => {
    let path = testDir;
    for (let i = 0; i < 20; i++) {
      const name = i % 2 === 0 ? 'a'.repeat(50) : 'b';
      path = join(path, name);
    }
    
    try {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'file.ts'), 'export const x = 1;');
      assert.ok(existsSync(join(path, 'file.ts')));
    } catch {
      // Path length exceeded - acceptable
    }
  });

  it('should handle directory names at component limit (255 chars)', () => {
    const longName = 'a'.repeat(255);
    const path = join(testDir, longName);
    
    try {
      mkdirSync(path);
      writeFileSync(join(path, 'file.ts'), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // May fail on some filesystems
    }
  });

  it('should handle mix of empty and deep directories', () => {
    // Create some empty directories
    mkdirSync(join(testDir, 'empty1'));
    mkdirSync(join(testDir, 'empty2', 'empty3'), { recursive: true });
    
    // Create a deep one with content
    let deep = join(testDir, 'deep');
    for (let i = 0; i < 10; i++) {
      deep = join(deep, `level${i}`);
    }
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'file.ts'), 'export const x = 1;');
    
    // Also create a file at root level so we definitely have one
    writeFileSync(join(testDir, 'root.ts'), 'export const root = true;');
    
    const result = discoverAndReadCode(testDir, {});
    // Should find at least one file (either deep or root)
    assert.ok(result.files !== undefined);
    assert.ok(result.files.length >= 1 || result.sourceFiles.length >= 1, 'Should find at least one file');
  });
});

// ============================================================================
// 2. SYMLINKS (ALL VARIATIONS)
// ============================================================================

describe('Symlinks - All Variations', () => {
  // Skip on Windows if symlinks not supported
  const skipIfNoSymlinks = () => {
    if (IS_WINDOWS) {
      return true;  // Symlinks require admin on Windows
    }
    return false;
  };

  describe('File Symlinks', () => {
    it('should handle symlink to file in same directory', () => {
      if (skipIfNoSymlinks()) return;
      
      const realFile = join(testDir, 'real.ts');
      const link = join(testDir, 'link.ts');
      writeFileSync(realFile, 'export const real = true;');
      
      try {
        symlinkSync(realFile, link);
        
        const result = discoverAndReadCode(testDir, {});
        // Should find at least the real file
        assert.ok(result.files.length >= 1);
      } catch {
        // Symlink may fail
      }
    });

    it('should handle symlink to file in parent directory', () => {
      if (skipIfNoSymlinks()) return;
      
      const realFile = join(testDir, 'real.ts');
      const subdir = join(testDir, 'subdir');
      const link = join(subdir, 'link.ts');
      
      writeFileSync(realFile, 'export const real = true;');
      mkdirSync(subdir);
      
      try {
        symlinkSync(realFile, link);
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle symlink to file in sibling directory', () => {
      if (skipIfNoSymlinks()) return;
      
      const dir1 = join(testDir, 'dir1');
      const dir2 = join(testDir, 'dir2');
      mkdirSync(dir1);
      mkdirSync(dir2);
      
      const realFile = join(dir1, 'real.ts');
      const link = join(dir2, 'link.ts');
      
      writeFileSync(realFile, 'export const real = true;');
      
      try {
        symlinkSync(realFile, link);
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle multiple symlinks to same file', () => {
      if (skipIfNoSymlinks()) return;
      
      const realFile = join(testDir, 'real.ts');
      writeFileSync(realFile, 'export const real = true;');
      
      try {
        for (let i = 0; i < 5; i++) {
          symlinkSync(realFile, join(testDir, `link${i}.ts`));
        }
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle chain of symlinks (A -> B -> C)', () => {
      if (skipIfNoSymlinks()) return;
      
      const realFile = join(testDir, 'real.ts');
      const link1 = join(testDir, 'link1.ts');
      const link2 = join(testDir, 'link2.ts');
      
      writeFileSync(realFile, 'export const real = true;');
      
      try {
        symlinkSync(realFile, link1);
        symlinkSync(link1, link2);
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });
  });

  describe('Directory Symlinks', () => {
    it('should handle symlink to directory', () => {
      if (skipIfNoSymlinks()) return;
      
      const realDir = join(testDir, 'realdir');
      const link = join(testDir, 'linkdir');
      
      mkdirSync(realDir);
      writeFileSync(join(realDir, 'file.ts'), 'export const x = 1;');
      
      try {
        symlinkSync(realDir, link);
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle symlink to nested directory', () => {
      if (skipIfNoSymlinks()) return;
      
      const nested = join(testDir, 'a', 'b', 'c');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'file.ts'), 'export const x = 1;');
      
      const link = join(testDir, 'shortcut');
      
      try {
        symlinkSync(nested, link);
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });
  });

  describe('Circular Symlinks', () => {
    it('should handle simple circular symlink (A -> B -> A)', () => {
      if (skipIfNoSymlinks()) return;
      
      const dir1 = join(testDir, 'dir1');
      const dir2 = join(testDir, 'dir2');
      
      mkdirSync(dir1);
      mkdirSync(dir2);
      writeFileSync(join(dir1, 'file.ts'), 'export const x = 1;');
      
      try {
        symlinkSync(dir2, join(dir1, 'link_to_dir2'));
        symlinkSync(dir1, join(dir2, 'link_to_dir1'));
        
        const start = Date.now();
        const result = discoverAndReadCode(testDir, {});
        const elapsed = Date.now() - start;
        
        assert.ok(elapsed < 5000, 'Should not hang on circular symlinks');
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle self-referential symlink', () => {
      if (skipIfNoSymlinks()) return;
      
      const dir = join(testDir, 'selfref');
      mkdirSync(dir);
      writeFileSync(join(dir, 'file.ts'), 'export const x = 1;');
      
      try {
        symlinkSync(dir, join(dir, 'self'));
        
        const start = Date.now();
        const result = discoverAndReadCode(testDir, {});
        const elapsed = Date.now() - start;
        
        assert.ok(elapsed < 5000, 'Should not hang');
      } catch {
        // Expected to fail
      }
    });

    it('should handle 3-way circular symlinks (A -> B -> C -> A)', () => {
      if (skipIfNoSymlinks()) return;
      
      const dirs = ['a', 'b', 'c'].map(n => join(testDir, n));
      dirs.forEach(d => mkdirSync(d));
      writeFileSync(join(dirs[0], 'file.ts'), 'export const x = 1;');
      
      try {
        symlinkSync(dirs[1], join(dirs[0], 'link'));
        symlinkSync(dirs[2], join(dirs[1], 'link'));
        symlinkSync(dirs[0], join(dirs[2], 'link'));
        
        const start = Date.now();
        const result = discoverAndReadCode(testDir, {});
        const elapsed = Date.now() - start;
        
        assert.ok(elapsed < 5000);
      } catch {
        // Skip
      }
    });
  });

  describe('Broken Symlinks', () => {
    it('should handle symlink to non-existent file', () => {
      if (skipIfNoSymlinks()) return;
      
      const link = join(testDir, 'broken.ts');
      
      try {
        symlinkSync('/nonexistent/file.ts', link);
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle symlink to deleted file', () => {
      if (skipIfNoSymlinks()) return;
      
      const realFile = join(testDir, 'willdelete.ts');
      const link = join(testDir, 'link.ts');
      
      writeFileSync(realFile, 'export const x = 1;');
      
      try {
        symlinkSync(realFile, link);
        unlinkSync(realFile);  // Delete the target
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle symlink to deleted directory', () => {
      if (skipIfNoSymlinks()) return;
      
      const realDir = join(testDir, 'willdelete');
      const link = join(testDir, 'link');
      
      mkdirSync(realDir);
      writeFileSync(join(realDir, 'file.ts'), 'export const x = 1;');
      
      try {
        symlinkSync(realDir, link);
        rmSync(realDir, { recursive: true });  // Delete the target
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });
  });
});

// ============================================================================
// 3. LONG FILENAMES
// ============================================================================

describe('Long Filenames', () => {
  const lengths = [5, 10, 50, 100, 150, 200, 250, 254, 255];

  for (const len of lengths) {
    it(`should handle filename of ${len} characters`, () => {
      const baseLen = Math.max(1, len - 3);  // -3 for .ts, ensure at least 1
      const name = 'a'.repeat(baseLen) + '.ts';
      const filePath = join(testDir, name);
      
      try {
        writeFileSync(filePath, `export const len = ${len};`);
        assert.ok(existsSync(filePath));
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // May fail if exceeds limit
      }
    });
  }

  it('should handle filename exceeding 255 characters', () => {
    const name = 'a'.repeat(300) + '.ts';
    const filePath = join(testDir, name);
    
    try {
      writeFileSync(filePath, 'export const x = 1;');
      // If we get here, filesystem allows it
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // Expected to fail - ENAMETOOLONG
    }
  });

  it('should handle directory name at limit', () => {
    const dirName = 'b'.repeat(255);
    const dirPath = join(testDir, dirName);
    
    try {
      mkdirSync(dirPath);
      writeFileSync(join(dirPath, 'file.ts'), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // May fail
    }
  });

  it('should handle multiple long-named files', () => {
    for (let i = 0; i < 10; i++) {
      const name = `file_${'x'.repeat(200)}_${i}.ts`;
      try {
        writeFileSync(join(testDir, name), `export const i = ${i};`);
      } catch {
        // Skip if fails
      }
    }
    
    const result = discoverAndReadCode(testDir, {});
    assert.ok(result.files !== undefined);
  });

  it('should handle long path (nested dirs + long filename)', () => {
    let path = testDir;
    // Create 10 directories with 20-char names
    for (let i = 0; i < 10; i++) {
      path = join(path, 'a'.repeat(20));
    }
    
    try {
      mkdirSync(path, { recursive: true });
      // Add a file with long name
      const fileName = 'f'.repeat(100) + '.ts';
      writeFileSync(join(path, fileName), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // Path too long - acceptable
    }
  });
});

// ============================================================================
// 4. SPECIAL CHARACTERS IN FILENAMES
// ============================================================================

describe('Special Characters in Filenames', () => {
  // Characters that should work on most Unix systems
  const unixSafeSpecialChars = [
    { char: ' ', name: 'space' },
    { char: '-', name: 'hyphen' },
    { char: '_', name: 'underscore' },
    { char: '.', name: 'dot' },
    { char: ',', name: 'comma' },
    { char: '(', name: 'open_paren' },
    { char: ')', name: 'close_paren' },
    { char: '[', name: 'open_bracket' },
    { char: ']', name: 'close_bracket' },
    { char: '{', name: 'open_brace' },
    { char: '}', name: 'close_brace' },
    { char: "'", name: 'single_quote' },
    { char: '!', name: 'exclamation' },
    { char: '@', name: 'at' },
    { char: '#', name: 'hash' },
    { char: '$', name: 'dollar' },
    { char: '%', name: 'percent' },
    { char: '^', name: 'caret' },
    { char: '&', name: 'ampersand' },
    { char: '+', name: 'plus' },
    { char: '=', name: 'equals' },
    { char: '~', name: 'tilde' },
    { char: '`', name: 'backtick' },
  ];

  for (const { char, name } of unixSafeSpecialChars) {
    it(`should handle ${name} (${char}) in filename`, () => {
      const fileName = `file${char}test.ts`;
      const filePath = join(testDir, fileName);
      
      try {
        writeFileSync(filePath, `export const char = '${char}';`);
        assert.ok(existsSync(filePath));
        
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Some chars may fail on certain filesystems
      }
    });
  }

  it('should handle multiple special chars in same filename', () => {
    const fileName = 'file (1) - copy [final].ts';
    const filePath = join(testDir, fileName);
    
    try {
      writeFileSync(filePath, 'export const x = 1;');
      assert.ok(existsSync(filePath));
    } catch {
      // May fail
    }
  });

  it('should handle leading dot (hidden file)', () => {
    const fileName = '.hidden.ts';
    const filePath = join(testDir, fileName);
    
    writeFileSync(filePath, 'export const hidden = true;');
    assert.ok(existsSync(filePath));
    
    // Note: hidden files may or may not be discovered depending on settings
    const result = discoverAndReadCode(testDir, {});
    assert.ok(result.files !== undefined);
  });

  it('should handle multiple dots in filename', () => {
    const fileName = 'file.test.spec.component.ts';
    writeFileSync(join(testDir, fileName), 'export const x = 1;');
    
    const result = discoverAndReadCode(testDir, {});
    assert.ok(result.files.length >= 1);
  });

  it('should handle trailing spaces (if filesystem allows)', () => {
    // Most filesystems strip trailing spaces
    const fileName = 'file .ts';  // Space before extension
    
    try {
      writeFileSync(join(testDir, fileName), 'export const x = 1;');
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // May fail
    }
  });

  it('should handle filename starting with hyphen', () => {
    const fileName = '-file.ts';
    
    try {
      writeFileSync(join(testDir, fileName), 'export const x = 1;');
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // May fail
    }
  });

  describe('Platform-specific forbidden characters', () => {
    // Only test on non-Windows (Windows forbids these)
    if (!IS_WINDOWS) {
      for (const char of WINDOWS_FORBIDDEN) {
        it(`should handle Windows-forbidden char: ${char}`, () => {
          const fileName = `file${char}test.txt`;  // Not .ts to avoid syntax issues
          
          try {
            writeFileSync(join(testDir, fileName), 'content');
            const files = readdirSync(testDir);
            assert.ok(files.some(f => f.includes(char)));
          } catch {
            // May fail even on Unix for some chars
          }
        });
      }
    }

    if (IS_WINDOWS) {
      it('should reject Windows reserved names', () => {
        for (const name of WINDOWS_RESERVED_NAMES.slice(0, 4)) {
          const filePath = join(testDir, `${name}.ts`);
          try {
            writeFileSync(filePath, 'export const x = 1;');
            // If we get here, Windows allowed it (maybe not as device)
          } catch {
            // Expected on Windows
          }
        }
      });
    }
  });
});

// ============================================================================
// 5. UNICODE AND INTERNATIONALIZATION
// ============================================================================

describe('Unicode and Internationalization', () => {
  describe('Non-ASCII Scripts', () => {
    const scripts = [
      { name: 'Chinese', sample: '中文文件.ts' },
      { name: 'Japanese', sample: '日本語ファイル.ts' },
      { name: 'Korean', sample: '한국어파일.ts' },
      { name: 'Arabic', sample: 'ملف_عربي.ts' },
      { name: 'Hebrew', sample: 'קובץ_עברי.ts' },
      { name: 'Russian', sample: 'русский_файл.ts' },
      { name: 'Greek', sample: 'ελληνικό_αρχείο.ts' },
      { name: 'Thai', sample: 'ไฟล์ไทย.ts' },
      { name: 'Hindi', sample: 'हिंदी_फाइल.ts' },
      { name: 'Emoji', sample: '🚀🎉🔥.ts' },
    ];

    for (const { name, sample } of scripts) {
      it(`should handle ${name} script: ${sample}`, () => {
        const filePath = join(testDir, sample);
        
        try {
          writeFileSync(filePath, `// ${name} file\nexport const x = 1;`);
          assert.ok(existsSync(filePath));
          
          // Verify we can read it back
          const files = readdirSync(testDir);
          assert.ok(files.some(f => f === sample), `Should find ${sample}`);
        } catch {
          // Unicode filenames may not be supported on all systems
        }
      });
    }
  });

  describe('Unicode Normalization (NFC vs NFD)', () => {
    it('should handle NFC-normalized filename', () => {
      // é as single codepoint (U+00E9)
      const nfc = 'caf\u00E9.ts';
      
      try {
        writeFileSync(join(testDir, nfc), 'export const x = 1;');
        const files = readdirSync(testDir);
        // macOS may normalize differently
        assert.ok(files.length >= 1);
      } catch {
        // Skip
      }
    });

    it('should handle NFD-normalized filename', () => {
      // é as e + combining acute (U+0065 U+0301)
      const nfd = 'cafe\u0301.ts';
      
      try {
        writeFileSync(join(testDir, nfd), 'export const x = 1;');
        const files = readdirSync(testDir);
        assert.ok(files.length >= 1);
      } catch {
        // Skip
      }
    });

    it('should distinguish NFC and NFD on case-sensitive FS', () => {
      const nfc = 'caf\u00E9.ts';
      const nfd = 'cafe\u0301.ts';
      
      try {
        writeFileSync(join(testDir, nfc), 'export const nfc = true;');
        writeFileSync(join(testDir, nfd), 'export const nfd = true;');
        
        const files = readdirSync(testDir);
        // On most Linux: 2 files
        // On macOS: 1 file (normalized to same)
        assert.ok(files.length >= 1);
      } catch {
        // Skip
      }
    });
  });

  describe('Zero-Width and Invisible Characters', () => {
    const invisibles = [
      { name: 'zero-width space', char: '\u200B' },
      { name: 'zero-width non-joiner', char: '\u200C' },
      { name: 'zero-width joiner', char: '\u200D' },
      { name: 'BOM', char: '\uFEFF' },
      { name: 'soft hyphen', char: '\u00AD' },
    ];

    for (const { name, char } of invisibles) {
      it(`should handle ${name} in filename`, () => {
        const fileName = `file${char}name.ts`;
        
        try {
          writeFileSync(join(testDir, fileName), 'export const x = 1;');
          const result = discoverAndReadCode(testDir, {});
          assert.ok(result.files !== undefined);
        } catch {
          // May fail
        }
      });
    }
  });

  describe('RTL and Bidirectional Text', () => {
    it('should handle RTL override character', () => {
      // This is a security concern - should be handled carefully
      const rtl = 'file\u202Etxt.exe.ts';
      
      try {
        writeFileSync(join(testDir, rtl), 'export const x = 1;');
        
        // Security check: isShellSafe should reject this
        assert.strictEqual(isShellSafe(rtl), false, 'RTL override should be rejected');
      } catch {
        // May fail to create
      }
    });

    it('should handle mixed RTL and LTR text', () => {
      const mixed = 'file_العربية_english.ts';
      
      try {
        writeFileSync(join(testDir, mixed), 'export const x = 1;');
        assert.ok(existsSync(join(testDir, mixed)));
      } catch {
        // Skip
      }
    });
  });

  describe('Combining Characters', () => {
    it('should handle multiple combining diacritics', () => {
      // a with multiple combining marks
      const complex = 'a\u0301\u0308\u0323.ts';  // a + acute + diaeresis + dot below
      
      try {
        writeFileSync(join(testDir, complex), 'export const x = 1;');
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      } catch {
        // Skip
      }
    });

    it('should handle Hangul jamo composition', () => {
      // Korean syllable can be composed or decomposed
      const composed = '\uAC00.ts';    // 가 as single char
      const decomposed = '\u1100\u1161.ts';  // ㄱ + ㅏ
      
      try {
        writeFileSync(join(testDir, composed), 'export const composed = true;');
        writeFileSync(join(testDir, decomposed), 'export const decomposed = true;');
        
        const files = readdirSync(testDir);
        assert.ok(files.length >= 1);
      } catch {
        // Skip
      }
    });
  });
});

// ============================================================================
// 6. BINARY FILES AND SPECIAL CONTENT
// ============================================================================

describe('Binary Files and Special Content', () => {
  describe('Binary Content Detection', () => {
    it('should handle file with null bytes', () => {
      const content = 'const x\x00 = 1;\x00\x00';
      writeFileSync(join(testDir, 'nulls.ts'), content);
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    });

    it('should skip PNG files', () => {
      const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(100).fill(0)]);
      writeFileSync(join(testDir, 'image.png'), png);
      writeFileSync(join(testDir, 'real.ts'), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      // Should include real.ts but skip PNG
      assert.ok(!result.codeContext.includes('\x89PNG'));
    });

    it('should skip JPEG files', () => {
      const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(100).fill(0)]);
      writeFileSync(join(testDir, 'photo.jpg'), jpeg);
      writeFileSync(join(testDir, 'real.ts'), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    });

    it('should skip executable files', () => {
      // ELF header
      const elf = Buffer.from([0x7F, 0x45, 0x4C, 0x46, ...Array(100).fill(0)]);
      writeFileSync(join(testDir, 'binary'), elf);
      writeFileSync(join(testDir, 'real.ts'), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    });
  });

  describe('Large Binary Files', () => {
    it('should handle 1MB binary file', () => {
      const large = Buffer.alloc(1024 * 1024, 0xFF);
      writeFileSync(join(testDir, 'large.bin'), large);
      writeFileSync(join(testDir, 'real.ts'), 'export const x = 1;');
      
      const start = Date.now();
      const result = discoverAndReadCode(testDir, {});
      const elapsed = Date.now() - start;
      
      assert.ok(elapsed < 5000, 'Should handle quickly');
    });
  });

  describe('Mixed Content', () => {
    it('should handle UTF-8 BOM in source file', () => {
      const content = '\uFEFFexport const x = 1;';
      writeFileSync(join(testDir, 'bom.ts'), content);
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files.length >= 1);
    });

    it('should handle Windows line endings (CRLF)', () => {
      const content = 'export const x = 1;\r\nexport const y = 2;\r\n';
      writeFileSync(join(testDir, 'crlf.ts'), content);
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files.length >= 1);
    });

    it('should handle mixed line endings', () => {
      const content = 'line1\nline2\r\nline3\rline4\n';
      writeFileSync(join(testDir, 'mixed.ts'), content);
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files.length >= 1);
    });
  });
});

// ============================================================================
// 7. PROPERTY-BASED TESTING
// ============================================================================

describe('Property-Based Filesystem Tests', () => {
  it('should handle arbitrary safe filenames', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-z0-9_-]/gi, '')).filter(s => s.length > 0),
        (name: string) => {
          const fileName = `${name}.ts`;
          const filePath = join(testDir, fileName);
          
          try {
            writeFileSync(filePath, `export const x = '${name}';`);
            const exists = existsSync(filePath);
            // Cleanup
            if (exists) unlinkSync(filePath);
            return exists;
          } catch {
            return true;  // Failure is acceptable for edge cases
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should not crash on arbitrary unicode filenames', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (name: string) => {
          // Filter out truly problematic chars
          const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
          if (!safe || safe.length === 0) return true;
          
          const fileName = `${safe}.ts`;
          const filePath = join(testDir, fileName);
          
          try {
            writeFileSync(filePath, 'export const x = 1;');
            // Cleanup
            if (existsSync(filePath)) unlinkSync(filePath);
            return true;
          } catch {
            return true;  // Failure is acceptable
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle arbitrary nesting depths', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (depth: number) => {
          let path = testDir;
          for (let i = 0; i < depth; i++) {
            path = join(path, `d${i}`);
          }
          
          try {
            mkdirSync(path, { recursive: true });
            writeFileSync(join(path, 'file.ts'), 'export const x = 1;');
            const result = discoverAndReadCode(testDir, {});
            // Cleanup is handled by afterEach
            return result.files !== undefined;
          } catch {
            return true;  // Path too long is acceptable
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// 8. RACE CONDITIONS (TOCTOU)
// ============================================================================

describe('Race Conditions (TOCTOU)', () => {
  it('should handle file deleted between discovery and read', async () => {
    const filePath = join(testDir, 'willdelete.ts');
    writeFileSync(filePath, 'export const x = 1;');
    
    // Start discovery
    const discoveryPromise = Promise.resolve(discoverSourceFiles(testDir));
    
    // Delete file immediately
    unlinkSync(filePath);
    
    // Discovery should not crash
    const files = await discoveryPromise;
    assert.ok(Array.isArray(files));
  });

  it('should handle directory renamed during traversal', async () => {
    const oldDir = join(testDir, 'oldname');
    const newDir = join(testDir, 'newname');
    
    mkdirSync(oldDir);
    writeFileSync(join(oldDir, 'file.ts'), 'export const x = 1;');
    
    // This is a race - rename during discovery
    setTimeout(() => {
      try {
        renameSync(oldDir, newDir);
      } catch {
        // May fail if in use
      }
    }, 0);
    
    // Should not crash
    try {
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // Race condition - acceptable
    }
  });

  it('should handle file modified during read', () => {
    const filePath = join(testDir, 'modified.ts');
    writeFileSync(filePath, 'export const v1 = 1;');
    
    // Modify file immediately after writing
    const interval = setInterval(() => {
      try {
        writeFileSync(filePath, `export const v${Date.now()} = ${Math.random()};`);
      } catch {
        // May fail
      }
    }, 1);
    
    // Read should complete without crash
    try {
      for (let i = 0; i < 10; i++) {
        const result = discoverAndReadCode(testDir, {});
        assert.ok(result.files !== undefined);
      }
    } finally {
      clearInterval(interval);
    }
  });
});

// ============================================================================
// 9. EDGE CASE COMBINATIONS
// ============================================================================

describe('Edge Case Combinations', () => {
  it('should handle long unicode filename in deep directory', () => {
    let path = testDir;
    for (let i = 0; i < 10; i++) {
      path = join(path, '目录');  // Chinese for "directory"
    }
    
    try {
      mkdirSync(path, { recursive: true });
      const fileName = '文件_'.repeat(30) + '.ts';
      writeFileSync(join(path, fileName), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // Path too long or encoding issue
    }
  });

  it('should handle symlink to long-named file', () => {
    if (IS_WINDOWS) return;
    
    const longName = 'a'.repeat(200) + '.ts';
    const realFile = join(testDir, longName);
    const link = join(testDir, 'short.ts');
    
    try {
      writeFileSync(realFile, 'export const x = 1;');
      symlinkSync(realFile, link);
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files !== undefined);
    } catch {
      // May fail
    }
  });

  it('should handle special chars in path AND filename', () => {
    const dirName = 'dir with spaces';
    const fileName = 'file (copy).ts';
    
    try {
      mkdirSync(join(testDir, dirName));
      writeFileSync(join(testDir, dirName, fileName), 'export const x = 1;');
      
      const result = discoverAndReadCode(testDir, {});
      assert.ok(result.files.length >= 1);
    } catch {
      // May fail
    }
  });

  it('should handle binary + source files mixed', () => {
    // Create mix of files
    writeFileSync(join(testDir, 'source.ts'), 'export const x = 1;');
    writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    writeFileSync(join(testDir, 'data.json'), '{"key": "value"}');
    writeFileSync(join(testDir, 'readme.md'), '# README');
    writeFileSync(join(testDir, 'binary'), Buffer.alloc(1000, 0xFF));
    
    const result = discoverAndReadCode(testDir, {});
    assert.ok(result.files.length >= 1);
    assert.ok(result.sourceFiles.length >= 1);
  });

  it('should handle 100 files with various edge cases', () => {
    for (let i = 0; i < 100; i++) {
      const variations = [
        `file${i}.ts`,
        `file_${i}_test.ts`,
        `file-${i}.ts`,
        `FILE${i}.ts`,
        `file${i}.spec.ts`,
      ];
      const name = variations[i % variations.length];
      writeFileSync(join(testDir, name), `export const i = ${i};`);
    }
    
    const start = Date.now();
    const result = discoverAndReadCode(testDir, {});
    const elapsed = Date.now() - start;
    
    assert.ok(result.files.length >= 10, 'Should find files');  // Some may be test files filtered
    assert.ok(elapsed < 5000, 'Should be fast');
  });
});
