import { describe, expect, test } from 'vitest'
import { extractJson, ParseError } from '../src/api/parse'

describe('extractJson', () => {
  test('parses bare JSON objects and arrays', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 })
    expect(extractJson('[1, 2]')).toEqual([1, 2])
    expect(extractJson('  {"a": 1}  ')).toEqual({ a: 1 })
  })

  test('strips markdown fences, with or without a language tag', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(extractJson('```json\n[{"a": 1}]\n```')).toEqual([{ a: 1 }])
  })

  test('extracts the outermost object from surrounding prose', () => {
    expect(extractJson('Here is your motif batch:\n{"motifs": [{"x": 1}]}\nEnjoy!')).toEqual({
      motifs: [{ x: 1 }],
    })
  })

  test('nested braces survive first-{ to last-} extraction', () => {
    expect(extractJson('note {"a": {"b": {"c": 3}}} done')).toEqual({ a: { b: { c: 3 } } })
  })

  test('throws ParseError when there is no JSON at all', () => {
    expect(() => extractJson('sorry, I cannot do that')).toThrow(ParseError)
    expect(() => extractJson('')).toThrow(ParseError)
    expect(() => extractJson('} backwards {')).toThrow(ParseError)
  })

  test('throws ParseError on truncated JSON (max_tokens cutoff)', () => {
    expect(() => extractJson('{"motifs": [{"pitch": 60, "start')).toThrow(ParseError)
  })

  test('error messages are actionable', () => {
    expect(() => extractJson('nope')).toThrow(/no JSON object found/)
    expect(() => extractJson('{bad json}')).toThrow(/invalid JSON/)
  })
})
