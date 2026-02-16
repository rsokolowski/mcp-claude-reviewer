import { describe, it, expect } from '@jest/globals';
import { relaxedJsonParse } from '../../../src/utils/json-parse';

describe('relaxedJsonParse', () => {
  describe('valid JSON passthrough', () => {
    it('parses valid JSON objects', () => {
      expect(relaxedJsonParse('{"a": 1, "b": "hello"}')).toEqual({ a: 1, b: 'hello' });
    });

    it('parses valid JSON arrays', () => {
      expect(relaxedJsonParse('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('parses valid nested structures', () => {
      const input = '{"a": [1, 2], "b": {"c": true}}';
      expect(relaxedJsonParse(input)).toEqual({ a: [1, 2], b: { c: true } });
    });

    it('parses strings with special characters', () => {
      expect(relaxedJsonParse('{"msg": "hello\\nworld"}')).toEqual({ msg: 'hello\nworld' });
    });
  });

  describe('trailing commas', () => {
    it('removes trailing comma in object', () => {
      expect(relaxedJsonParse('{"a": 1,}')).toEqual({ a: 1 });
    });

    it('removes trailing comma in array', () => {
      expect(relaxedJsonParse('[1, 2, 3,]')).toEqual([1, 2, 3]);
    });

    it('removes trailing comma with whitespace before closing brace', () => {
      expect(relaxedJsonParse('{"a": 1 ,  }')).toEqual({ a: 1 });
    });

    it('removes trailing comma with newlines before closing brace', () => {
      const input = `{
        "a": 1,
        "b": 2,
      }`;
      expect(relaxedJsonParse(input)).toEqual({ a: 1, b: 2 });
    });

    it('removes trailing commas in nested structures', () => {
      const input = `{
        "items": [1, 2, 3,],
        "nested": {"x": true,},
      }`;
      expect(relaxedJsonParse(input)).toEqual({
        items: [1, 2, 3],
        nested: { x: true }
      });
    });
  });

  describe('single-line comments', () => {
    it('strips single-line comments', () => {
      const input = `{
        // this is a comment
        "a": 1
      }`;
      expect(relaxedJsonParse(input)).toEqual({ a: 1 });
    });

    it('strips end-of-line comments', () => {
      const input = `{
        "a": 1 // inline comment
      }`;
      expect(relaxedJsonParse(input)).toEqual({ a: 1 });
    });
  });

  describe('multi-line comments', () => {
    it('strips multi-line comments', () => {
      const input = `{
        /* this is
           a multi-line comment */
        "a": 1
      }`;
      expect(relaxedJsonParse(input)).toEqual({ a: 1 });
    });

    it('strips inline multi-line comments', () => {
      const input = '{"a": /* comment */ 1}';
      expect(relaxedJsonParse(input)).toEqual({ a: 1 });
    });
  });

  describe('string boundary preservation', () => {
    it('preserves // inside strings', () => {
      expect(relaxedJsonParse('{"url": "https://example.com"}')).toEqual({
        url: 'https://example.com'
      });
    });

    it('preserves /* inside strings', () => {
      expect(relaxedJsonParse('{"pattern": "/* glob */"}')).toEqual({
        pattern: '/* glob */'
      });
    });

    it('preserves trailing commas inside strings', () => {
      expect(relaxedJsonParse('{"msg": "a, b,}"}')).toEqual({
        msg: 'a, b,}'
      });
    });

    it('preserves escaped quotes in strings', () => {
      expect(relaxedJsonParse('{"msg": "say \\"hello\\""}')).toEqual({
        msg: 'say "hello"'
      });
    });

    it('handles escaped quotes followed by trailing comma', () => {
      expect(relaxedJsonParse('{"a": "he said \\"hi\\"",}')).toEqual({
        a: 'he said "hi"'
      });
    });
  });

  describe('combined issues', () => {
    it('handles comments and trailing commas together', () => {
      const input = `{
        // Review output
        "status": "needs_changes",
        "comments": [
          {"text": "fix this",}, // trailing comma + comment
        ],
      }`;
      expect(relaxedJsonParse(input)).toEqual({
        status: 'needs_changes',
        comments: [{ text: 'fix this' }]
      });
    });
  });

  describe('LLM-like review JSON', () => {
    it('parses realistic LLM review output with trailing commas', () => {
      const input = `{
        "overall_assessment": "needs_changes",
        "design_compliance": {
          "follows_architecture": true,
          "major_violations": [],
        },
        "comments": [
          {
            "file": "src/index.ts",
            "line": 42,
            "severity": "major",
            "category": "bug",
            "comment": "Potential null dereference",
            "suggestion": "Add null check before accessing property",
          },
        ],
        "missing_requirements": [],
        "test_results": {
          "passed": true,
          "details": "All tests pass",
        },
      }`;
      const parsed = relaxedJsonParse(input) as Record<string, any>;
      expect(parsed.overall_assessment).toBe('needs_changes');
      expect(parsed.comments).toHaveLength(1);
      expect(parsed.comments[0].file).toBe('src/index.ts');
      expect(parsed.design_compliance.follows_architecture).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws on completely invalid input', () => {
      expect(() => relaxedJsonParse('not json at all')).toThrow();
    });

    it('throws on empty input', () => {
      expect(() => relaxedJsonParse('')).toThrow();
    });
  });
});
