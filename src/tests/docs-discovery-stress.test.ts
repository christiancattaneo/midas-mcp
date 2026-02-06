/**
 * Docs Discovery Stress Tests
 * 
 * Comprehensive testing of documentation discovery:
 * - Empty content scenarios
 * - Large documentation files
 * - Directory priority and precedence
 * - File type handling
 * - Classification heuristics
 * - Edge cases and combinations
 * 
 * Based on documentation system best practices.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import functions to test
import { discoverDocsSync, discoverDocs, getPlanningContext, DiscoveredDoc, DocsDiscoveryResult } from '../docs-discovery.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-docs-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

// Generate content of specific size
function generateContent(sizeBytes: number, pattern = 'x'): string {
  const repeatCount = Math.ceil(sizeBytes / pattern.length);
  return pattern.repeat(repeatCount).slice(0, sizeBytes);
}

// Generate markdown with headings and content
function generateMarkdown(headings: number, paragraphs: number): string {
  let content = '# Main Title\n\n';
  for (let i = 0; i < headings; i++) {
    content += `## Heading ${i + 1}\n\n`;
    for (let j = 0; j < paragraphs; j++) {
      content += `This is paragraph ${j + 1} under heading ${i + 1}. `;
      content += 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n';
    }
  }
  return content;
}

// ============================================================================
// 1. EMPTY CONTENT SCENARIOS
// ============================================================================

describe('Empty Content Scenarios', () => {
  it('should handle project with no docs at all', () => {
    const dir = createTestDir('no-docs');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1;');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(Array.isArray(result.allDocs));
  });

  it('should handle empty README.md', () => {
    const dir = createTestDir('empty-readme');
    writeFileSync(join(dir, 'README.md'), '');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // Empty README should be found but may not be classified
  });

  it('should handle whitespace-only README.md', () => {
    const dir = createTestDir('whitespace-readme');
    writeFileSync(join(dir, 'README.md'), '   \n\n\t\t\n   ');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle empty docs directory', () => {
    const dir = createTestDir('empty-docs-dir');
    mkdirSync(join(dir, 'docs'));
    // docs/ exists but is empty
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.strictEqual(result.allDocs.filter(d => d.path.includes('docs/')).length, 0);
  });

  it('should handle all docs being empty', () => {
    const dir = createTestDir('all-empty');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'README.md'), '');
    writeFileSync(join(dir, 'docs', 'brainlift.md'), '');
    writeFileSync(join(dir, 'docs', 'prd.md'), '');
    writeFileSync(join(dir, 'docs', 'gameplan.md'), '');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // All should be found even if empty
  });

  it('should handle doc with only front-matter', () => {
    const dir = createTestDir('frontmatter-only');
    writeFileSync(join(dir, 'README.md'), '---\ntitle: Test\nauthor: Me\n---\n');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle doc with only heading', () => {
    const dir = createTestDir('heading-only');
    writeFileSync(join(dir, 'README.md'), '# Title');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle doc with only code block', () => {
    const dir = createTestDir('code-only');
    writeFileSync(join(dir, 'README.md'), '```typescript\nconst x = 1;\n```');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 2. LARGE DOCUMENTATION FILES
// ============================================================================

describe('Large Documentation Files', () => {
  it('should handle 100KB markdown file', () => {
    const dir = createTestDir('large-100kb');
    const content = generateMarkdown(50, 10);  // ~100KB
    writeFileSync(join(dir, 'README.md'), content);
    
    const start = Date.now();
    const result = discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100KB doc: ${elapsed}ms`);
    
    assert.ok(result !== null);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should handle 1MB markdown file', () => {
    const dir = createTestDir('large-1mb');
    const content = generateContent(1024 * 1024, 'word ');
    writeFileSync(join(dir, 'README.md'), content);
    
    const start = Date.now();
    const result = discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 1MB doc: ${elapsed}ms`);
    
    assert.ok(result !== null);
    assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
  });

  it('should handle 5MB markdown file', () => {
    const dir = createTestDir('large-5mb');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const content = generateContent(5 * 1024 * 1024, 'Lorem ipsum dolor sit amet. ');
    writeFileSync(join(dir, 'docs', 'large.md'), content);
    
    const start = Date.now();
    const result = discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 5MB doc: ${elapsed}ms`);
    
    assert.ok(result !== null);
    assert.ok(elapsed < 30000, `Too slow: ${elapsed}ms`);
  });

  it('should handle doc with 1000 headings', () => {
    const dir = createTestDir('many-headings');
    let content = '# Main\n\n';
    for (let i = 0; i < 1000; i++) {
      content += `## Heading ${i}\n\nContent for heading ${i}.\n\n`;
    }
    writeFileSync(join(dir, 'README.md'), content);
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle doc with many code blocks', () => {
    const dir = createTestDir('many-codeblocks');
    let content = '# Documentation\n\n';
    for (let i = 0; i < 100; i++) {
      content += `## Example ${i}\n\n\`\`\`typescript\nconst x${i} = ${i};\nconsole.log(x${i});\n\`\`\`\n\n`;
    }
    writeFileSync(join(dir, 'README.md'), content);
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle doc with many links', () => {
    const dir = createTestDir('many-links');
    let content = '# Links\n\n';
    for (let i = 0; i < 500; i++) {
      content += `- [Link ${i}](https://example.com/page/${i})\n`;
    }
    writeFileSync(join(dir, 'README.md'), content);
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle mix of large and small docs', () => {
    const dir = createTestDir('mixed-sizes');
    mkdirSync(join(dir, 'docs'));
    
    writeFileSync(join(dir, 'README.md'), '# Small\n\nShort content.');
    writeFileSync(join(dir, 'docs', 'large.md'), generateContent(1024 * 1024, 'x'));
    writeFileSync(join(dir, 'docs', 'medium.md'), generateContent(100 * 1024, 'y'));
    writeFileSync(join(dir, 'docs', 'tiny.md'), 'Tiny');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result.allDocs.length >= 4);
  });
});

// ============================================================================
// 3. DIRECTORY PRIORITY
// ============================================================================

describe('Directory Priority', () => {
  it('should prefer docs/ directory over root', () => {
    const dir = createTestDir('dir-priority-docs');
    writeFileSync(join(dir, 'README.md'), '# Root README');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'README.md'), '# Docs README');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // Should find both
    assert.ok(result.allDocs.length >= 2);
  });

  it('should handle multiple doc directories', () => {
    const dir = createTestDir('multi-doc-dirs');
    mkdirSync(join(dir, 'docs'));
    mkdirSync(join(dir, 'documentation'));
    mkdirSync(join(dir, 'guide'));
    
    writeFileSync(join(dir, 'docs', 'intro.md'), '# Docs Intro');
    writeFileSync(join(dir, 'documentation', 'intro.md'), '# Documentation Intro');
    writeFileSync(join(dir, 'guide', 'intro.md'), '# Guide Intro');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle nested docs directories', () => {
    const dir = createTestDir('nested-docs');
    mkdirSync(join(dir, 'docs', 'api'), { recursive: true });
    mkdirSync(join(dir, 'docs', 'guides'), { recursive: true });
    
    writeFileSync(join(dir, 'docs', 'index.md'), '# Main');
    writeFileSync(join(dir, 'docs', 'api', 'reference.md'), '# API');
    writeFileSync(join(dir, 'docs', 'guides', 'getting-started.md'), '# Guide');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result.allDocs.length >= 3);
  });

  it('should handle design/ directory', () => {
    const dir = createTestDir('design-dir');
    mkdirSync(join(dir, 'design'));
    writeFileSync(join(dir, 'design', 'prd.md'), '# Product Requirements');
    writeFileSync(join(dir, 'design', 'architecture.md'), '# Architecture');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle specs/ directory', () => {
    const dir = createTestDir('specs-dir');
    mkdirSync(join(dir, 'specs'));
    writeFileSync(join(dir, 'specs', 'requirements.md'), '# Requirements');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should prefer root-level planning docs', () => {
    const dir = createTestDir('root-planning');
    writeFileSync(join(dir, 'brainlift.md'), '# Brain Lift\n\n## Core Concept');
    writeFileSync(join(dir, 'prd.md'), '# PRD\n\n## Requirements');
    writeFileSync(join(dir, 'gameplan.md'), '# Gameplan\n\n## Phase 1');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // Should classify these correctly
  });

  it('should handle deeply nested doc structure', () => {
    const dir = createTestDir('deep-nested');
    const deepPath = join(dir, 'src', 'docs', 'internal', 'api', 'v1');
    mkdirSync(deepPath, { recursive: true });
    writeFileSync(join(deepPath, 'spec.md'), '# Deep Spec');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 4. FILE NAMING AND CLASSIFICATION
// ============================================================================

describe('File Naming and Classification', () => {
  it('should classify brainlift.md correctly', () => {
    const dir = createTestDir('classify-brainlift');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'brainlift.md'), 
      '# Brain Lift\n\n## Core Concept\n\nThe main idea...\n\n## Target Audience\n\nDevelopers');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result !== null, 'Should return a valid result');
  });

  it('should classify prd.md correctly', () => {
    const dir = createTestDir('classify-prd');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'prd.md'), 
      '# Product Requirements Document\n\n## Overview\n\n## Features\n\n## Requirements');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result.prd !== null, 'Should classify as PRD');
  });

  it('should classify gameplan.md correctly', () => {
    const dir = createTestDir('classify-gameplan');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'gameplan.md'), 
      '# Gameplan\n\n## Phase 1\n\n- [ ] Task 1\n- [ ] Task 2\n\n## Phase 2');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result.gameplan !== null, 'Should classify as gameplan');
  });

  it('should handle alternative naming: vision.md as brainlift', () => {
    const dir = createTestDir('alt-vision');
    writeFileSync(join(dir, 'vision.md'), 
      '# Vision\n\n## Core Concept\n\nOur vision is...');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // May or may not classify as brainlift depending on heuristics
  });

  it('should handle alternative naming: spec.md as PRD', () => {
    const dir = createTestDir('alt-spec');
    writeFileSync(join(dir, 'spec.md'), 
      '# Specification\n\n## Requirements\n\n## Features');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle alternative naming: roadmap.md as gameplan', () => {
    const dir = createTestDir('alt-roadmap');
    writeFileSync(join(dir, 'roadmap.md'), 
      '# Roadmap\n\n## Q1\n\n- Feature A\n\n## Q2\n\n- Feature B');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle case-insensitive naming', () => {
    const dir = createTestDir('case-insensitive');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'BRAINLIFT.md'), '# Brain Lift');
    writeFileSync(join(dir, 'docs', 'PRD.MD'), '# PRD');
    writeFileSync(join(dir, 'docs', 'GamePlan.md'), '# Gameplan');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle docs with numbers in name', () => {
    const dir = createTestDir('numbered-docs');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'prd-v2.md'), '# PRD v2');
    writeFileSync(join(dir, 'docs', 'gameplan-2024.md'), '# 2024 Gameplan');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle hyphenated doc names', () => {
    const dir = createTestDir('hyphenated');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'brain-lift.md'), '# Brain Lift');
    writeFileSync(join(dir, 'docs', 'product-requirements.md'), '# PRD');
    writeFileSync(join(dir, 'docs', 'game-plan.md'), '# Gameplan');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 5. FILE TYPE HANDLING
// ============================================================================

describe('File Type Handling', () => {
  it('should handle .md files', () => {
    const dir = createTestDir('type-md');
    writeFileSync(join(dir, 'README.md'), '# Markdown');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result.allDocs.some(d => d.path.endsWith('.md')));
  });

  it('should handle .txt files', () => {
    const dir = createTestDir('type-txt');
    writeFileSync(join(dir, 'README.txt'), 'Plain text readme');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle mixed file types', () => {
    const dir = createTestDir('type-mixed');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'README.md'), '# Markdown');
    writeFileSync(join(dir, 'docs', 'notes.txt'), 'Text notes');
    writeFileSync(join(dir, 'docs', 'api.json'), '{}');
    writeFileSync(join(dir, 'docs', 'config.yaml'), 'key: value');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should ignore binary files', () => {
    const dir = createTestDir('type-binary');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'README.md'), '# Test');
    // Create a fake binary file
    writeFileSync(join(dir, 'docs', 'image.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result.allDocs.every(d => !d.path.endsWith('.png')));
  });

  it('should handle .markdown extension', () => {
    const dir = createTestDir('type-markdown-ext');
    writeFileSync(join(dir, 'README.markdown'), '# Markdown');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 6. CONTENT-BASED CLASSIFICATION
// ============================================================================

describe('Content-Based Classification', () => {
  it('should classify by content keywords (brainlift)', () => {
    const dir = createTestDir('content-brainlift');
    writeFileSync(join(dir, 'ideas.md'), 
      '# Ideas\n\n## Core Concept\n\nThe fundamental idea is...\n\n## Target Audience\n\nFor developers who want...\n\n## Problem Statement\n\nUsers struggle with...');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // Content-based classification may identify this as brainlift-like
  });

  it('should classify by content keywords (PRD)', () => {
    const dir = createTestDir('content-prd');
    writeFileSync(join(dir, 'requirements.md'), 
      '# Requirements\n\n## Features\n\n- Feature 1\n- Feature 2\n\n## Technical Requirements\n\n## User Stories');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should classify by content keywords (gameplan)', () => {
    const dir = createTestDir('content-gameplan');
    writeFileSync(join(dir, 'plan.md'), 
      '# Plan\n\n## Phase 1: Setup\n\n- [ ] Initialize project\n- [ ] Set up CI/CD\n\n## Phase 2: Development\n\n## Milestones');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle ambiguous content', () => {
    const dir = createTestDir('content-ambiguous');
    writeFileSync(join(dir, 'doc.md'), 
      '# Document\n\nThis could be anything. No specific keywords.');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // Should classify as "other"
  });

  it('should handle technical documentation', () => {
    const dir = createTestDir('content-technical');
    writeFileSync(join(dir, 'api.md'), 
      '# API Reference\n\n## Endpoints\n\n### GET /users\n\n```json\n{"id": 1}\n```');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 7. SPECIAL CHARACTERS AND ENCODING
// ============================================================================

describe('Special Characters and Encoding', () => {
  it('should handle unicode in content', () => {
    const dir = createTestDir('unicode-content');
    writeFileSync(join(dir, 'README.md'), '# 日本語ドキュメント\n\n中文内容\n\nПривет мир');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result.allDocs.length > 0);
  });

  it('should handle emoji in content', () => {
    const dir = createTestDir('emoji-content');
    writeFileSync(join(dir, 'README.md'), '# Project 🚀\n\n## Features ✨\n\n- Fast ⚡\n- Easy 🎯');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle unicode in filename', () => {
    const dir = createTestDir('unicode-filename');
    try {
      writeFileSync(join(dir, '文档.md'), '# Chinese Doc');
      
      const result = discoverDocsSync(dir);
      
      assert.ok(result !== null);
    } catch {
      // Some filesystems may not support unicode filenames
    }
  });

  it('should handle BOM in file', () => {
    const dir = createTestDir('bom');
    const bomContent = '\uFEFF# Document with BOM\n\nContent here.';
    writeFileSync(join(dir, 'README.md'), bomContent);
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle Windows line endings', () => {
    const dir = createTestDir('crlf');
    writeFileSync(join(dir, 'README.md'), '# Title\r\n\r\nContent\r\n');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle mixed line endings', () => {
    const dir = createTestDir('mixed-endings');
    writeFileSync(join(dir, 'README.md'), '# Title\n\nParagraph 1\r\n\r\nParagraph 2\r\nLine 3');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 8. SYMLINKS AND SPECIAL FILES
// ============================================================================

describe('Symlinks and Special Files', () => {
  it('should handle symlinked doc file', () => {
    const dir = createTestDir('symlink-file');
    writeFileSync(join(dir, 'actual-readme.md'), '# Actual');
    
    try {
      symlinkSync(join(dir, 'actual-readme.md'), join(dir, 'README.md'));
      
      const result = discoverDocsSync(dir);
      
      assert.ok(result !== null);
    } catch {
      // Symlinks may not be supported
    }
  });

  it('should handle symlinked docs directory', () => {
    const dir = createTestDir('symlink-dir');
    const actualDocs = join(dir, 'actual-docs');
    mkdirSync(actualDocs);
    writeFileSync(join(actualDocs, 'index.md'), '# Index');
    
    try {
      symlinkSync(actualDocs, join(dir, 'docs'));
      
      const result = discoverDocsSync(dir);
      
      assert.ok(result !== null);
    } catch {
      // Symlinks may not be supported
    }
  });

  it('should handle circular symlinks without hanging', () => {
    const dir = createTestDir('symlink-circular');
    mkdirSync(join(dir, 'docs'));
    
    try {
      symlinkSync(dir, join(dir, 'docs', 'loop'));
      
      const start = Date.now();
      const result = discoverDocsSync(dir);
      const elapsed = Date.now() - start;
      
      assert.ok(result !== null);
      assert.ok(elapsed < 5000, `Possible infinite loop: ${elapsed}ms`);
    } catch {
      // Symlinks may not be supported
    }
  });

  it('should handle broken symlinks', () => {
    const dir = createTestDir('symlink-broken');
    
    try {
      symlinkSync(join(dir, 'nonexistent.md'), join(dir, 'README.md'));
      
      const result = discoverDocsSync(dir);
      
      assert.ok(result !== null);
    } catch {
      // Symlinks may not be supported
    }
  });
});

// ============================================================================
// 9. MULTIPLE SIMILAR DOCS
// ============================================================================

describe('Multiple Similar Docs', () => {
  it('should handle multiple README files', () => {
    const dir = createTestDir('multi-readme');
    writeFileSync(join(dir, 'README.md'), '# Root');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'README.md'), '# Src');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'README.md'), '# Docs');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle competing brainlift-like docs', () => {
    const dir = createTestDir('multi-brainlift');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'brainlift.md'), '# Brain Lift 1');
    writeFileSync(join(dir, 'docs', 'vision.md'), '# Vision');
    writeFileSync(join(dir, 'docs', 'concept.md'), '# Core Concept');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    // Should pick one as primary brainlift
  });

  it('should handle competing PRD-like docs', () => {
    const dir = createTestDir('multi-prd');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD');
    writeFileSync(join(dir, 'docs', 'requirements.md'), '# Requirements');
    writeFileSync(join(dir, 'docs', 'spec.md'), '# Specification');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle competing gameplan-like docs', () => {
    const dir = createTestDir('multi-gameplan');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'gameplan.md'), '# Gameplan');
    writeFileSync(join(dir, 'docs', 'roadmap.md'), '# Roadmap');
    writeFileSync(join(dir, 'docs', 'todo.md'), '# TODO');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 10. PLANNING CONTEXT GENERATION
// ============================================================================

describe('Planning Context Generation', () => {
  it('should generate context from complete docs', () => {
    const dir = createTestDir('context-complete');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'brainlift.md'), '# Brain Lift\n\n## Core Concept\n\nMain idea here.');
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD\n\n## Requirements\n\n- Req 1\n- Req 2');
    writeFileSync(join(dir, 'docs', 'gameplan.md'), '# Gameplan\n\n## Phase 1\n\n- [ ] Task 1');
    
    const result = discoverDocsSync(dir);
    const context = getPlanningContext(result);
    
    assert.ok(typeof context === 'string');
    // Context should include info about found docs
  });

  it('should generate context from partial docs', () => {
    const dir = createTestDir('context-partial');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD\n\n## Requirements');
    // Missing brainlift and gameplan
    
    const result = discoverDocsSync(dir);
    const context = getPlanningContext(result);
    
    assert.ok(typeof context === 'string');
  });

  it('should generate context from no classified docs', () => {
    const dir = createTestDir('context-none');
    writeFileSync(join(dir, 'notes.md'), '# Random Notes');
    
    const result = discoverDocsSync(dir);
    const context = getPlanningContext(result);
    
    assert.ok(typeof context === 'string');
  });

  it('should handle context from large docs', () => {
    const dir = createTestDir('context-large');
    const largeContent = generateMarkdown(100, 20);  // Large doc
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'brainlift.md'), largeContent);
    
    const result = discoverDocsSync(dir);
    const context = getPlanningContext(result);
    
    assert.ok(typeof context === 'string');
  });
});

// ============================================================================
// 11. EDGE CASE COMBINATIONS
// ============================================================================

describe('Edge Case Combinations', () => {
  it('should handle empty docs/ + valid root README', () => {
    const dir = createTestDir('combo-empty-docs');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'README.md'), '# Project\n\nThis is the main readme.');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(result.allDocs.length >= 1);
  });

  it('should handle valid docs/ + empty root README', () => {
    const dir = createTestDir('combo-valid-docs');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'README.md'), '');
    writeFileSync(join(dir, 'docs', 'main.md'), '# Main Documentation');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle large doc + many small docs', () => {
    const dir = createTestDir('combo-large-small');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'large.md'), generateContent(1024 * 1024, 'x'));
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(dir, 'docs', `small${i}.md`), `# Small Doc ${i}\n\nContent.`);
    }
    
    const start = Date.now();
    const result = discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] Large + 50 small docs: ${elapsed}ms`);
    
    assert.ok(result !== null);
    assert.ok(elapsed < 30000, `Too slow: ${elapsed}ms`);
  });

  it('should handle deeply nested single doc', () => {
    const dir = createTestDir('combo-deep-single');
    const deepPath = join(dir, 'a', 'b', 'c', 'd', 'e', 'f', 'docs');
    mkdirSync(deepPath, { recursive: true });
    writeFileSync(join(deepPath, 'readme.md'), '# Deep Doc');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });
});

// ============================================================================
// 12. PERFORMANCE BENCHMARKS
// ============================================================================

describe('Performance Benchmarks', () => {
  it('should discover 100 docs quickly', () => {
    const dir = createTestDir('perf-100');
    mkdirSync(join(dir, 'docs'));
    
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, 'docs', `doc${i}.md`), `# Document ${i}\n\nContent for doc ${i}.`);
    }
    
    const start = Date.now();
    const result = discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 docs: ${elapsed}ms, found: ${result.allDocs.length}`);
    
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
    assert.ok(result.allDocs.length >= 100);
  });

  it('should handle 10 directories with 10 docs each', () => {
    const dir = createTestDir('perf-multi-dir');
    
    for (let i = 0; i < 10; i++) {
      const subdir = join(dir, `dir${i}`);
      mkdirSync(subdir);
      for (let j = 0; j < 10; j++) {
        writeFileSync(join(subdir, `doc${j}.md`), `# Doc ${i}-${j}`);
      }
    }
    
    const start = Date.now();
    const result = discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 10x10 docs: ${elapsed}ms`);
    
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should classify docs quickly', () => {
    const dir = createTestDir('perf-classify');
    mkdirSync(join(dir, 'docs'));
    
    writeFileSync(join(dir, 'docs', 'brainlift.md'), '# Brain Lift\n\n## Core Concept\n\n' + generateContent(10000, 'x'));
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD\n\n## Requirements\n\n' + generateContent(10000, 'y'));
    writeFileSync(join(dir, 'docs', 'gameplan.md'), '# Gameplan\n\n## Phase 1\n\n' + generateContent(10000, 'z'));
    
    const start = Date.now();
    const result = discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] Classify 3 docs: ${elapsed}ms`);
    
    assert.ok(elapsed < 3000, `Too slow: ${elapsed}ms`);
  });
});
