/**
 * Token Estimation Stress Tests
 * 
 * Comprehensive testing of token estimation accuracy across:
 * - Symbol-heavy code (operators, punctuation)
 * - Unicode (CJK, Arabic, emoji, combining diacritics)
 * - Edge cases (empty, whitespace, control chars)
 * - Accuracy validation against known tokenization patterns
 * 
 * Note: Our estimator uses chars/4 which is a rough heuristic.
 * These tests document known accuracy limitations and ensure
 * the estimator never crashes or returns invalid values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';

import { estimateTokens } from '../context.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if estimate is within acceptable bounds.
 * For most English text, 1 token ≈ 4 chars.
 * For code/symbols, each symbol ≈ 1 token.
 * For CJK, each char ≈ 2-3 tokens.
 */
function isReasonableEstimate(text: string, estimate: number): boolean {
  if (text.length === 0) return estimate === 0;
  
  // Must be positive
  if (estimate <= 0) return false;
  
  // Must not be absurdly high or low
  // Min: 1 token per 10 chars (very compressed)
  // Max: 3 tokens per char (very expanded, like base64)
  const minEstimate = Math.ceil(text.length / 10);
  const maxEstimate = text.length * 3;
  
  return estimate >= minEstimate && estimate <= maxEstimate;
}

// ============================================================================
// 1. BASIC EDGE CASES
// ============================================================================

describe('Basic Edge Cases', () => {
  describe('Empty and Whitespace', () => {
    it('should return 0 for empty string', () => {
      assert.strictEqual(estimateTokens(''), 0);
    });

    it('should handle single space', () => {
      const estimate = estimateTokens(' ');
      assert.ok(estimate >= 0);
    });

    it('should handle multiple spaces', () => {
      const estimate = estimateTokens('     ');
      assert.ok(estimate >= 1);
    });

    it('should handle newline only', () => {
      const estimate = estimateTokens('\n');
      assert.ok(estimate >= 0);
    });

    it('should handle multiple newlines', () => {
      const estimate = estimateTokens('\n\n\n\n\n');
      assert.ok(estimate >= 1);
    });

    it('should handle tab only', () => {
      const estimate = estimateTokens('\t');
      assert.ok(estimate >= 0);
    });

    it('should handle mixed whitespace', () => {
      const estimate = estimateTokens('  \n\t  \r\n  ');
      assert.ok(estimate >= 1);
    });

    it('should handle zero-width spaces', () => {
      const zws = '\u200B\u200C\u200D\uFEFF';
      const estimate = estimateTokens(zws);
      assert.ok(estimate >= 0);
    });
  });

  describe('Single Characters', () => {
    const singleChars = [
      'a', 'Z', '0', '9', ' ', '.', ',', '!', '@', '#',
      '$', '%', '^', '&', '*', '(', ')', '-', '+', '=',
      '[', ']', '{', '}', '|', '\\', '/', '?', '<', '>',
      ':', ';', '"', "'", '`', '~',
    ];

    for (const char of singleChars) {
      it(`should handle single char: ${char.charCodeAt(0).toString(16)}`, () => {
        const estimate = estimateTokens(char);
        assert.ok(estimate >= 1, `Expected >= 1 for '${char}'`);
      });
    }
  });
});

// ============================================================================
// 2. SYMBOL-HEAVY CODE
// ============================================================================

describe('Symbol-Heavy Code', () => {
  describe('Operators and Punctuation', () => {
    it('should handle arithmetic operators', () => {
      const ops = '+ - * / % ** ++ -- += -= *= /= %= **=';
      const estimate = estimateTokens(ops);
      assert.ok(isReasonableEstimate(ops, estimate));
    });

    it('should handle comparison operators', () => {
      const ops = '== === != !== < > <= >= <=> ?? ?. ?.';
      const estimate = estimateTokens(ops);
      assert.ok(isReasonableEstimate(ops, estimate));
    });

    it('should handle logical operators', () => {
      const ops = '&& || ! !! & | ^ ~ << >> >>> &&= ||= ??=';
      const estimate = estimateTokens(ops);
      assert.ok(isReasonableEstimate(ops, estimate));
    });

    it('should handle brackets and braces (100 repeats)', () => {
      const brackets = '(){}[]<>'.repeat(100);
      const estimate = estimateTokens(brackets);
      
      // 800 chars, each bracket typically 1 token
      // Our estimate: 800/4 = 200
      // Actual: ~800 tokens
      // This documents the underestimation
      assert.ok(estimate > 0);
      assert.ok(estimate >= 100);  // At minimum
    });

    it('should handle mixed punctuation', () => {
      const punct = '.,;:!?@#$%^&*()[]{}/<>|\\`~'.repeat(50);
      const estimate = estimateTokens(punct);
      assert.ok(estimate > 0);
    });

    it('should handle regex patterns', () => {
      const regex = '/^[a-zA-Z0-9_]+@[a-zA-Z0-9]+\\.[a-zA-Z]{2,}$/';
      const estimate = estimateTokens(regex);
      assert.ok(isReasonableEstimate(regex, estimate));
    });

    it('should handle JavaScript template literals', () => {
      const template = '${variable} ${obj.prop} ${arr[0]} ${fn()}';
      const estimate = estimateTokens(template);
      assert.ok(isReasonableEstimate(template, estimate));
    });
  });

  describe('Code Patterns', () => {
    it('should handle TypeScript generics', () => {
      const code = 'Map<string, Array<Promise<Result<T, E>>>>()';
      const estimate = estimateTokens(code);
      assert.ok(isReasonableEstimate(code, estimate));
    });

    it('should handle arrow functions', () => {
      const code = '(a, b) => ({ x: a + b, y: a - b, z: a * b })';
      const estimate = estimateTokens(code);
      assert.ok(isReasonableEstimate(code, estimate));
    });

    it('should handle destructuring', () => {
      const code = 'const { a, b: { c, d }, e: [f, g, ...h] } = obj;';
      const estimate = estimateTokens(code);
      assert.ok(isReasonableEstimate(code, estimate));
    });

    it('should handle decorators', () => {
      const code = '@Injectable() @Component({ selector: "app" }) class MyClass {}';
      const estimate = estimateTokens(code);
      assert.ok(isReasonableEstimate(code, estimate));
    });

    it('should handle JSON with special chars', () => {
      const json = '{"key":"value","arr":[1,2,3],"obj":{"nested":true}}';
      const estimate = estimateTokens(json);
      assert.ok(isReasonableEstimate(json, estimate));
    });

    it('should handle minified code', () => {
      const minified = 'function a(b,c){return b+c}var d=a(1,2);console.log(d)';
      const estimate = estimateTokens(minified);
      assert.ok(isReasonableEstimate(minified, estimate));
    });

    it('should handle shell commands', () => {
      const shell = 'cat file.txt | grep "pattern" | awk \'{print $1}\' | sort -u > output.txt';
      const estimate = estimateTokens(shell);
      assert.ok(isReasonableEstimate(shell, estimate));
    });

    it('should handle SQL queries', () => {
      const sql = 'SELECT u.*, COUNT(*) FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.active = 1 GROUP BY u.id HAVING COUNT(*) > 5 ORDER BY u.name ASC LIMIT 10;';
      const estimate = estimateTokens(sql);
      assert.ok(isReasonableEstimate(sql, estimate));
    });
  });

  describe('Extreme Symbol Density', () => {
    it('should handle 1000 consecutive symbols', () => {
      const symbols = '!@#$%^&*()'.repeat(100);
      const estimate = estimateTokens(symbols);
      
      // Document: each symbol is roughly 1 token
      // chars/4 gives 1000/4 = 250, actual ~1000
      // This is a known 4x underestimation for pure symbols
      assert.ok(estimate >= 100);
    });

    it('should handle alternating symbols and letters', () => {
      const mixed = 'a!b@c#d$e%f^g&h*i(j)'.repeat(50);
      const estimate = estimateTokens(mixed);
      assert.ok(estimate >= 100);
    });

    it('should handle mathematical expressions', () => {
      const math = '(a + b) * (c - d) / (e % f) ** (g ^ h) | (i & j) << k >> l';
      const estimate = estimateTokens(math);
      assert.ok(isReasonableEstimate(math, estimate));
    });
  });
});

// ============================================================================
// 3. UNICODE CHARACTERS
// ============================================================================

describe('Unicode Characters', () => {
  describe('CJK (Chinese, Japanese, Korean)', () => {
    it('should handle Chinese text', () => {
      const chinese = '你好世界这是一个测试用例需要估计令牌数量';
      const estimate = estimateTokens(chinese);
      
      // Each Chinese char typically = 2-3 tokens
      // 16 chars * 2.5 ≈ 40 tokens
      // chars/4 = 4 tokens (severe underestimate)
      assert.ok(estimate > 0);
    });

    it('should handle Japanese hiragana', () => {
      const hiragana = 'こんにちはせかいこれはテストです';
      const estimate = estimateTokens(hiragana);
      assert.ok(estimate > 0);
    });

    it('should handle Japanese katakana', () => {
      const katakana = 'コンニチハセカイコレハテストデス';
      const estimate = estimateTokens(katakana);
      assert.ok(estimate > 0);
    });

    it('should handle Japanese kanji', () => {
      const kanji = '日本語文字列推定テスト';
      const estimate = estimateTokens(kanji);
      assert.ok(estimate > 0);
    });

    it('should handle Korean', () => {
      const korean = '안녕하세요세계이것은테스트입니다';
      const estimate = estimateTokens(korean);
      assert.ok(estimate > 0);
    });

    it('should handle mixed CJK', () => {
      const mixed = '你好こんにちは안녕하세요';
      const estimate = estimateTokens(mixed);
      assert.ok(estimate > 0);
    });

    it('should handle 1000 Chinese characters', () => {
      const chinese = '测试'.repeat(500);
      const estimate = estimateTokens(chinese);
      
      // 1000 chars, actual ~2500 tokens
      // chars/4 = 250 (10x underestimate for CJK)
      assert.ok(estimate >= 100);
    });
  });

  describe('Right-to-Left Scripts', () => {
    it('should handle Arabic', () => {
      const arabic = 'مرحبا بالعالم هذا اختبار';
      const estimate = estimateTokens(arabic);
      assert.ok(estimate > 0);
    });

    it('should handle Hebrew', () => {
      const hebrew = 'שלום עולם זה מבחן';
      const estimate = estimateTokens(hebrew);
      assert.ok(estimate > 0);
    });

    it('should handle mixed RTL and LTR', () => {
      const mixed = 'Hello مرحبا World عالم';
      const estimate = estimateTokens(mixed);
      assert.ok(estimate > 0);
    });

    it('should handle RTL with numbers', () => {
      const rtlNum = 'العام ٢٠٢٥ والرقم ١٢٣٤';
      const estimate = estimateTokens(rtlNum);
      assert.ok(estimate > 0);
    });
  });

  describe('Other Scripts', () => {
    it('should handle Cyrillic (Russian)', () => {
      const russian = 'Привет мир это тест';
      const estimate = estimateTokens(russian);
      assert.ok(estimate > 0);
    });

    it('should handle Greek', () => {
      const greek = 'Γειά σου κόσμε αυτό είναι τεστ';
      const estimate = estimateTokens(greek);
      assert.ok(estimate > 0);
    });

    it('should handle Thai', () => {
      const thai = 'สวัสดีโลกนี่คือการทดสอบ';
      const estimate = estimateTokens(thai);
      assert.ok(estimate > 0);
    });

    it('should handle Hindi/Devanagari', () => {
      const hindi = 'नमस्ते दुनिया यह एक परीक्षण है';
      const estimate = estimateTokens(hindi);
      assert.ok(estimate > 0);
    });

    it('should handle Tamil', () => {
      const tamil = 'வணக்கம் உலகம் இது ஒரு சோதனை';
      const estimate = estimateTokens(tamil);
      assert.ok(estimate > 0);
    });

    it('should handle Georgian', () => {
      const georgian = 'გამარჯობა მსოფლიო ეს ტესტია';
      const estimate = estimateTokens(georgian);
      assert.ok(estimate > 0);
    });

    it('should handle Armenian', () => {
      const armenian = 'Բdelays գdelays րdelays delays';
      const estimate = estimateTokens(armenian);
      assert.ok(estimate > 0);
    });
  });

  describe('Emoji and Symbols', () => {
    it('should handle basic emoji', () => {
      const emoji = '😀😃😄😁😆😅🤣😂';
      const estimate = estimateTokens(emoji);
      
      // Each emoji is typically 1-2 tokens
      // But emoji are 2 UTF-16 code units each
      assert.ok(estimate > 0);
    });

    it('should handle emoji with skin tones', () => {
      const emoji = '👋🏻👋🏼👋🏽👋🏾👋🏿';
      const estimate = estimateTokens(emoji);
      assert.ok(estimate > 0);
    });

    it('should handle emoji sequences (ZWJ)', () => {
      // Family emoji: man + woman + girl + boy
      const family = '👨‍👩‍👧‍👦';
      const estimate = estimateTokens(family);
      assert.ok(estimate > 0);
    });

    it('should handle flag emoji', () => {
      const flags = '🇺🇸🇬🇧🇯🇵🇨🇳🇫🇷🇩🇪';
      const estimate = estimateTokens(flags);
      assert.ok(estimate > 0);
    });

    it('should handle 100 emoji', () => {
      const emoji = '🎉🚀🔥💯✨'.repeat(20);
      const estimate = estimateTokens(emoji);
      assert.ok(estimate > 0);
    });

    it('should handle mathematical symbols', () => {
      const math = '∀∃∄∅∆∇∈∉∊∋∌∍∎∏∐∑−∓∔∕∖∗∘∙√∛∜∝∞∟∠∡∢∣∤∥∦∧∨∩∪∫∬∭∮∯∰∱∲∳';
      const estimate = estimateTokens(math);
      assert.ok(estimate > 0);
    });

    it('should handle currency symbols', () => {
      const currency = '$€£¥₹₽₿¢₱₸₺₴₪₡₢₣₤₥₦₧₨₩₫€₭₮₯₰₱₲₳₴₵₶₷₸₹₺₻₼₽₾₿';
      const estimate = estimateTokens(currency);
      assert.ok(estimate > 0);
    });

    it('should handle arrows and shapes', () => {
      const arrows = '←↑→↓↔↕↖↗↘↙↚↛↜↝↞↟↠↡↢↣↤↥↦↧↨↩↪↫↬↭↮↯↰↱↲↳↴↵↶↷↸↹↺↻';
      const estimate = estimateTokens(arrows);
      assert.ok(estimate > 0);
    });

    it('should handle box drawing characters', () => {
      const box = '┌┬┐├┼┤└┴┘│─═║╔╦╗╠╬╣╚╩╝';
      const estimate = estimateTokens(box);
      assert.ok(estimate > 0);
    });
  });

  describe('Combining Characters and Diacritics', () => {
    it('should handle basic diacritics', () => {
      const diacritics = 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ';
      const estimate = estimateTokens(diacritics);
      assert.ok(estimate > 0);
    });

    it('should handle combining diacritical marks', () => {
      // e + combining acute + combining diaeresis
      const combining = 'e\u0301\u0308 o\u0302\u0303 a\u0300\u0323';
      const estimate = estimateTokens(combining);
      assert.ok(estimate > 0);
    });

    it('should handle Zalgo text', () => {
      // Text with many stacked combining characters
      const zalgo = 'H̸̡̪̯ͨ͊̽̅e̫̫̲̣̺̙̻̣̦l̸̡̪̲̮̯̤̥ļ̹͉̬͈̦ơ̴̹͉̟͔̤̱͍';
      const estimate = estimateTokens(zalgo);
      assert.ok(estimate > 0);
    });

    it('should handle Vietnamese with diacritics', () => {
      const vietnamese = 'Việt Nam có chữ viết rất phức tạp';
      const estimate = estimateTokens(vietnamese);
      assert.ok(estimate > 0);
    });

    it('should handle precomposed vs decomposed (NFC vs NFD)', () => {
      const nfc = 'café';  // é as single codepoint
      const nfd = 'cafe\u0301';  // e + combining acute
      
      const nfcEstimate = estimateTokens(nfc);
      const nfdEstimate = estimateTokens(nfd);
      
      // Both should give reasonable estimates
      assert.ok(nfcEstimate > 0);
      assert.ok(nfdEstimate > 0);
    });
  });
});

// ============================================================================
// 4. ACCURACY VALIDATION
// ============================================================================

describe('Accuracy Validation', () => {
  describe('English Text Baseline', () => {
    it('should estimate ~1 token per 4 chars for English prose', () => {
      const prose = 'The quick brown fox jumps over the lazy dog. This is a test of the token estimation function.';
      const estimate = estimateTokens(prose);
      
      // 93 chars / 4 ≈ 23 tokens
      // Actual tokenizers give ~20-25 tokens
      assert.ok(estimate >= 20 && estimate <= 30);
    });

    it('should handle repeated words', () => {
      const repeated = 'the '.repeat(100);
      const estimate = estimateTokens(repeated);
      
      // 400 chars / 4 = 100 tokens
      // Each "the " is roughly 1 token
      assert.ok(estimate >= 50 && estimate <= 150);
    });

    it('should handle code with English comments', () => {
      const code = `
// This function calculates the sum of two numbers
function add(a, b) {
  // Return the result
  return a + b;
}
`;
      const estimate = estimateTokens(code);
      assert.ok(isReasonableEstimate(code, estimate));
    });
  });

  describe('Known Underestimation Cases', () => {
    it('documents underestimation for pure symbols', () => {
      const symbols = '!@#$%^&*()'.repeat(100);
      const estimate = estimateTokens(symbols);
      const actual = symbols.length;  // Each symbol ≈ 1 token
      
      // Ratio documents the underestimation
      const ratio = actual / estimate;
      console.log(`  [INFO] Symbol underestimation ratio: ${ratio.toFixed(2)}x`);
      
      assert.ok(ratio >= 2, 'Symbols should show underestimation');
    });

    it('documents underestimation for CJK', () => {
      const cjk = '中文测试'.repeat(100);
      const estimate = estimateTokens(cjk);
      // Each CJK char ≈ 2-3 tokens, so 400 chars ≈ 800-1200 tokens
      // Our estimate: 400/4 = 100
      const expectedMin = cjk.length * 2;  // Conservative estimate
      
      const ratio = expectedMin / estimate;
      console.log(`  [INFO] CJK underestimation ratio: ${ratio.toFixed(2)}x`);
      
      assert.ok(ratio >= 5, 'CJK should show significant underestimation');
    });

    it('documents underestimation for emoji', () => {
      const emoji = '😀'.repeat(100);
      const estimate = estimateTokens(emoji);
      // Each emoji ≈ 1-2 tokens
      // Our estimate: 200/4 = 50 (because emoji are 2 UTF-16 units)
      
      console.log(`  [INFO] Emoji estimate: ${estimate} for ${emoji.length} chars`);
      assert.ok(estimate > 0);
    });
  });

  describe('Known Overestimation Cases', () => {
    it('may overestimate for whitespace-heavy content', () => {
      const spacey = '    x    '.repeat(100);
      const estimate = estimateTokens(spacey);
      
      // Whitespace often compresses in tokenization
      // 900 chars / 4 = 225, actual might be ~100
      console.log(`  [INFO] Whitespace estimate: ${estimate}`);
      assert.ok(estimate > 0);
    });

    it('may overestimate for repetitive content', () => {
      const repetitive = 'aaaa'.repeat(250);
      const estimate = estimateTokens(repetitive);
      
      // BPE compresses repetition
      // 1000 chars / 4 = 250, actual might be ~50
      console.log(`  [INFO] Repetitive estimate: ${estimate}`);
      assert.ok(estimate > 0);
    });
  });

  describe('Monotonicity Properties', () => {
    it('should be monotonic: longer text = more tokens', () => {
      const base = 'hello world';
      for (let i = 1; i <= 10; i++) {
        const text = base.repeat(i);
        const prev = i === 1 ? 0 : estimateTokens(base.repeat(i - 1));
        const curr = estimateTokens(text);
        
        assert.ok(curr >= prev, `Tokens should increase: ${prev} -> ${curr}`);
      }
    });

    it('should be strictly positive for non-empty strings', () => {
      const texts = ['a', ' ', '\n', '你', '😀', '.', '1'];
      for (const text of texts) {
        const estimate = estimateTokens(text);
        assert.ok(estimate >= 1, `Expected >= 1 for '${text}'`);
      }
    });
  });
});

// ============================================================================
// 5. EDGE CASES AND SPECIAL INPUTS
// ============================================================================

describe('Edge Cases and Special Inputs', () => {
  describe('Control Characters', () => {
    it('should handle null byte', () => {
      const withNull = 'hello\x00world';
      const estimate = estimateTokens(withNull);
      assert.ok(estimate > 0);
    });

    it('should handle bell character', () => {
      const withBell = 'hello\x07world';
      const estimate = estimateTokens(withBell);
      assert.ok(estimate > 0);
    });

    it('should handle backspace', () => {
      const withBS = 'hello\x08world';
      const estimate = estimateTokens(withBS);
      assert.ok(estimate > 0);
    });

    it('should handle form feed', () => {
      const withFF = 'hello\x0Cworld';
      const estimate = estimateTokens(withFF);
      assert.ok(estimate > 0);
    });

    it('should handle escape character', () => {
      const withEsc = 'hello\x1Bworld';
      const estimate = estimateTokens(withEsc);
      assert.ok(estimate > 0);
    });

    it('should handle all ASCII control chars', () => {
      let allControl = '';
      for (let i = 0; i < 32; i++) {
        allControl += String.fromCharCode(i);
      }
      const estimate = estimateTokens(allControl);
      assert.ok(estimate >= 0);
    });
  });

  describe('Unicode Edge Cases', () => {
    it('should handle surrogate pairs', () => {
      // Supplementary character (requires surrogate pair in UTF-16)
      const supplementary = '𝄞';  // Musical G clef, U+1D11E
      const estimate = estimateTokens(supplementary);
      assert.ok(estimate >= 1);
    });

    it('should handle isolated high surrogate', () => {
      const highSurrogate = '\uD800';
      const estimate = estimateTokens(highSurrogate);
      // Should not crash
      assert.ok(estimate >= 0);
    });

    it('should handle isolated low surrogate', () => {
      const lowSurrogate = '\uDC00';
      const estimate = estimateTokens(lowSurrogate);
      // Should not crash
      assert.ok(estimate >= 0);
    });

    it('should handle reversed surrogate pair', () => {
      const reversed = '\uDC00\uD800';  // Low followed by high
      const estimate = estimateTokens(reversed);
      assert.ok(estimate >= 0);
    });

    it('should handle BOM (byte order mark)', () => {
      const withBOM = '\uFEFFHello World';
      const estimate = estimateTokens(withBOM);
      assert.ok(estimate > 0);
    });

    it('should handle replacement character', () => {
      const replacement = '\uFFFD'.repeat(10);
      const estimate = estimateTokens(replacement);
      assert.ok(estimate > 0);
    });

    it('should handle private use area', () => {
      const pua = '\uE000\uE001\uE002';
      const estimate = estimateTokens(pua);
      assert.ok(estimate >= 0);
    });

    it('should handle noncharacters', () => {
      const nonchar = '\uFFFF\uFFFE';
      const estimate = estimateTokens(nonchar);
      assert.ok(estimate >= 0);
    });
  });

  describe('Very Long Inputs', () => {
    it('should handle 1MB of text', () => {
      const megabyte = 'x'.repeat(1024 * 1024);
      const start = Date.now();
      const estimate = estimateTokens(megabyte);
      const elapsed = Date.now() - start;
      
      assert.ok(estimate > 200000);  // At least 250k tokens
      assert.ok(elapsed < 1000, `Should be fast, took ${elapsed}ms`);
    });

    it('should handle 10MB of text', () => {
      const tenMB = 'y'.repeat(10 * 1024 * 1024);
      const start = Date.now();
      const estimate = estimateTokens(tenMB);
      const elapsed = Date.now() - start;
      
      assert.ok(estimate > 2000000);
      assert.ok(elapsed < 5000, `Should complete in <5s, took ${elapsed}ms`);
    });

    it('should handle very long single line', () => {
      const longLine = 'word '.repeat(100000);
      const estimate = estimateTokens(longLine);
      assert.ok(estimate > 50000);
    });

    it('should handle many short lines', () => {
      const manyLines = 'x\n'.repeat(100000);
      const estimate = estimateTokens(manyLines);
      assert.ok(estimate > 25000);
    });
  });

  describe('Mixed Content', () => {
    it('should handle code with emoji comments', () => {
      const code = `
// 🎉 This function is awesome! 🚀
function celebrate() {
  console.log("🔥 Hot code! 💯");
  return "✅ Success!";
}
`;
      const estimate = estimateTokens(code);
      assert.ok(isReasonableEstimate(code, estimate));
    });

    it('should handle multilingual text', () => {
      const multi = 'Hello 你好 مرحبا שלום Привет こんにちは 안녕하세요';
      const estimate = estimateTokens(multi);
      assert.ok(estimate > 0);
    });

    it('should handle code in different languages', () => {
      const mixedCode = `
// English comment
const message = "Hello";
// 日本語コメント
const メッセージ = "こんにちは";
// Комментарий на русском
const сообщение = "Привет";
`;
      const estimate = estimateTokens(mixedCode);
      assert.ok(estimate > 0);
    });
  });
});

// ============================================================================
// 6. PROPERTY-BASED TESTING
// ============================================================================

describe('Property-Based Testing', () => {
  it('should never return negative', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 1000 }),
        (s: string) => {
          const estimate = estimateTokens(s);
          return estimate >= 0;
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should return 0 only for empty string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (s: string) => {
          const estimate = estimateTokens(s);
          return estimate >= 1;
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should be deterministic', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        (s: string) => {
          const e1 = estimateTokens(s);
          const e2 = estimateTokens(s);
          return e1 === e2;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('should be monotonic with string length', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (base: string, suffix: string) => {
          const e1 = estimateTokens(base);
          const e2 = estimateTokens(base + suffix);
          return e2 >= e1;
        }
      ),
      { numRuns: 300 }
    );
  });

  it('should handle arbitrary unicode without crashing', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        (s: string) => {
          try {
            const estimate = estimateTokens(s);
            return typeof estimate === 'number' && !isNaN(estimate);
          } catch {
            return false;  // Should never throw
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should bound estimates reasonably', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1000 }),
        (s: string) => {
          const estimate = estimateTokens(s);
          // Should be at least 1 token per 10 chars
          // Should be at most 3 tokens per char
          const minReasonable = Math.ceil(s.length / 10);
          const maxReasonable = s.length * 3;
          return estimate >= minReasonable && estimate <= maxReasonable;
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ============================================================================
// 7. COMPARISON WITH KNOWN TOKENIZERS (DOCUMENTATION)
// ============================================================================

describe('Tokenizer Accuracy Documentation', () => {
  // These tests document expected behavior vs actual LLM tokenizers
  // They don't test against real tokenizers, but document known ratios
  
  it('documents: English text is ~4 chars/token', () => {
    const english = 'The quick brown fox jumps over the lazy dog.';
    const estimate = estimateTokens(english);
    const ratio = english.length / estimate;
    
    console.log(`  [DOC] English: ${english.length} chars / ${estimate} tokens = ${ratio.toFixed(2)} chars/token`);
    assert.ok(ratio >= 3 && ratio <= 5, 'English should be ~4 chars/token');
  });

  it('documents: code is ~3-4 chars/token', () => {
    const code = 'const x = (a, b) => a + b;';
    const estimate = estimateTokens(code);
    const ratio = code.length / estimate;
    
    console.log(`  [DOC] Code: ${code.length} chars / ${estimate} tokens = ${ratio.toFixed(2)} chars/token`);
    assert.ok(ratio >= 2 && ratio <= 6, 'Code should be ~3-4 chars/token');
  });

  it('documents: CJK is ~1-2 chars/token', () => {
    const cjk = '这是中文测试文本';
    const estimate = estimateTokens(cjk);
    const ratio = cjk.length / estimate;
    
    console.log(`  [DOC] CJK: ${cjk.length} chars / ${estimate} tokens = ${ratio.toFixed(2)} chars/token (underestimated)`);
    // Our estimator gives ~4, actual is ~1-2, so we underestimate
  });

  it('documents: symbols are ~1 char/token', () => {
    const symbols = '!@#$%^&*()[]{}';
    const estimate = estimateTokens(symbols);
    const ratio = symbols.length / estimate;
    
    console.log(`  [DOC] Symbols: ${symbols.length} chars / ${estimate} tokens = ${ratio.toFixed(2)} chars/token (underestimated)`);
    // Our estimator gives ~4, actual is ~1, so we underestimate
  });
});
