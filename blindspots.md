Categories of Blindspots Tested:
Race Conditions - Concurrent writes, interleaved read-modify-write
File System - Deep nesting, circular symlinks, binary files, long filenames, special chars
State Corruption - Corrupted JSON, empty files, null values, missing fields, huge files
Token Estimation - Symbol-heavy code, unicode, accuracy limitations
Git Edge Cases - No commits, missing .git, corrupted HEAD
Memory/Unbounded Growth - Array caps, large files, rapid writes
Path Security - Null bytes, path traversal, shell injection
JSON Fragility - Trailing commas, undefined values, NaN/Infinity
Async Edge Cases - Sync throws in async context
Infinite Loop Protection - Depth limits, regex backtracking
Empty/Null Data - Empty projects, dotfiles-only, no package.json
Docs Discovery - Empty content, large docs, directory priority
Reality Checks - Non-existent checks, long reasons, rapid updates
Phase State - Invalid phases, missing steps, history growth
Stuck Detection - No errors, fix attempt counting
Code Discovery - Test-only projects, config-only, unicode content
Performance - 100 files, 50 docs, timing boundaries
Injection beyond paths (command, SQL, template)
Deserialization attacks
Taint analysis / data flow tracking
Secret detection
Supply chain (dependency attacks)
Timing side channels
Algorithmic complexity attacks (ReDoS, etc)
Cryptographic weakness detection
Fuzzing infrastructure
Property-based / metamorphic testing