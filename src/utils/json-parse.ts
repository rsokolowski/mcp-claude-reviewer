/**
 * Relaxed JSON parser that handles common LLM output quirks:
 * - Trailing commas before } and ]
 * - Single-line comments (// ...)
 * - Multi-line comments (/* ... *​/)
 *
 * All sanitization respects JSON string boundaries.
 */
export function relaxedJsonParse(input: string): unknown {
  let result = '';
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Handle strings — copy verbatim including escapes
    if (ch === '"') {
      const start = i;
      i++; // skip opening quote
      while (i < len) {
        if (input[i] === '\\') {
          i += 2; // skip escaped character
        } else if (input[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          i++;
        }
      }
      result += input.substring(start, i);
      continue;
    }

    // Single-line comment
    if (ch === '/' && i + 1 < len && input[i + 1] === '/') {
      // Skip until end of line
      i += 2;
      while (i < len && input[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Multi-line comment
    if (ch === '/' && i + 1 < len && input[i + 1] === '*') {
      i += 2;
      while (i < len) {
        if (input[i] === '*' && i + 1 < len && input[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Trailing comma: comma followed (ignoring whitespace/comments) by } or ]
    if (ch === ',') {
      let j = i + 1;
      outer: while (j < len) {
        if (input[j] === ' ' || input[j] === '\t' || input[j] === '\n' || input[j] === '\r') {
          j++;
        } else if (input[j] === '/' && j + 1 < len && input[j + 1] === '/') {
          j += 2;
          while (j < len && input[j] !== '\n') j++;
        } else if (input[j] === '/' && j + 1 < len && input[j + 1] === '*') {
          j += 2;
          while (j < len) {
            // After consuming */, restart the whitespace/comment-skipping loop
            if (input[j] === '*' && j + 1 < len && input[j + 1] === '/') { j += 2; continue outer; }
            j++;
          }
        } else {
          break;
        }
      }
      if (j < len && (input[j] === '}' || input[j] === ']')) {
        i++;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return JSON.parse(result);
}
