import { describe, expect, it } from 'vitest';
import { compileExpr, compileWhere, ExprError, listFunctions, referencedFields, tryCompile, type ExprFeature } from './expr';

const feat = (properties: Record<string, any>, geometry: any = null, id: number | undefined = 1): ExprFeature => ({ id, properties, geometry });
const ev = (src: string, props: Record<string, any> = {}, geometry: any = null) => compileExpr(src)(feat(props, geometry));
const where = (src: string, props: Record<string, any> = {}) => compileWhere(src)(feat(props));

const square = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
};

describe('literals and arithmetic', () => {
  it('numbers', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('1e6')).toBe(1000000);
    expect(ev('2.5e-1')).toBe(0.25);
    expect(ev('.5 + .5')).toBe(1);
    expect(ev('10 % 3')).toBe(1);
    expect(ev('-3 + 5')).toBe(2);
    expect(ev('-(2 + 3)')).toBe(-5);
    expect(ev('- -2')).toBe(2);
  });
  it('division by zero is null', () => {
    expect(ev('1 / 0')).toBeNull();
    expect(ev('1 % 0')).toBeNull();
  });
  it('strings and escapes', () => {
    expect(ev("'it''s'")).toBe("it's");
    expect(ev('"say ""hi"""')).toBe('say "hi"');
    expect(ev("'a' + 'b'")).toBe('ab');
    expect(ev("'n=' + 5")).toBe('n=5');
    expect(ev("5 + 'x'")).toBe('5x');
  });
  it('booleans and null', () => {
    expect(ev('true')).toBe(true);
    expect(ev('FALSE')).toBe(false);
    expect(ev('null')).toBeNull();
  });
  it('null propagates through arithmetic', () => {
    expect(ev('A + 1', { A: null })).toBeNull();
    expect(ev('A * 2', {})).toBeNull();
  });
  it('numeric strings coerce in arithmetic', () => {
    expect(ev("'4' * 2")).toBe(8);
    expect(ev('A - 1', { A: '10' })).toBe(9);
  });
  it('empty source yields null', () => {
    expect(ev('')).toBeNull();
    expect(ev('   ')).toBeNull();
  });
});

describe('fields', () => {
  const p = { POP: 5000, NAME: 'Paris', 'Field With Spaces': 42, 'x y': 'q' };
  it('bare, bracketed and $feature', () => {
    expect(ev('POP', p)).toBe(5000);
    expect(ev('[Field With Spaces] + 1', p)).toBe(43);
    expect(ev('$feature.NAME', p)).toBe('Paris');
    expect(ev('$feature["x y"]', p)).toBe('q');
    expect(ev("$feature['POP']", p)).toBe(5000);
    expect(ev('$feature[NAME]', { NAME: 'POP', POP: 3 })).toBe(3);
  });
  it('case-insensitive fallback and unknown identifiers', () => {
    expect(ev('pop', p)).toBe(5000);
    expect(ev('Missing', p)).toBeNull();
    expect(() => compileExpr('Missing + 1')).not.toThrow();
  });
  it('a field may share a function name', () => {
    expect(ev('Area + 1', { Area: 4 })).toBe(5);
  });
  it('referencedFields', () => {
    expect(referencedFields("POP > 1 AND [Field With Spaces] LIKE 'a%' OR $feature.NAME = 'x' OR Round(AREA) > 2").sort()).toEqual(
      ['AREA', 'Field With Spaces', 'NAME', 'POP'].sort(),
    );
    expect(referencedFields('1 +')).toEqual([]);
    expect(referencedFields('')).toEqual([]);
    expect(referencedFields('POP + POP')).toEqual(['POP']);
    expect(referencedFields('$feature["a"] + TRUE')).toEqual(['a']);
  });
});

describe('comparison and logic', () => {
  const p = { POP: 500, NAME: 'Berlin', N: null, F: true };
  it('comparisons', () => {
    expect(where('POP > 100', p)).toBe(true);
    expect(where('POP >= 500 AND POP <= 500', p)).toBe(true);
    expect(where('POP = 500', p)).toBe(true);
    expect(where('POP == 500', p)).toBe(true);
    expect(where('POP != 500', p)).toBe(false);
    expect(where('POP <> 400', p)).toBe(true);
    expect(where("NAME = 'Berlin'", p)).toBe(true);
    expect(where("NAME = 'berlin'", p)).toBe(false);
    expect(where("NAME > 'A'", p)).toBe(true);
    expect(where("POP = '500'", p)).toBe(true);
  });
  it('comparisons with null are false', () => {
    expect(where('N = 1', p)).toBe(false);
    expect(where('N <> 1', p)).toBe(false);
    expect(where('N < 1', p)).toBe(false);
    expect(where('N = N', p)).toBe(false);
  });
  it('AND / OR / NOT precedence', () => {
    expect(where('POP > 1000 OR POP > 100 AND NAME = "Berlin"', p)).toBe(true);
    expect(where('(POP > 1000 OR POP > 100) AND NAME = "x"', p)).toBe(false);
    expect(where('NOT POP > 1000', p)).toBe(true);
    expect(where('not (POP > 100)', p)).toBe(false);
    expect(where('!(POP > 100) || POP < 1000', p)).toBe(true);
    expect(where('POP > 1 && NAME = "Berlin"', p)).toBe(true);
    expect(where('F', p)).toBe(true);
    expect(where('NOT F', p)).toBe(false);
  });
  it('lowercase keywords', () => {
    expect(where("pop > 1 and name like 'b%' or false", p)).toBe(true);
  });
  it('LIKE', () => {
    expect(where("NAME LIKE 'Ber%'", p)).toBe(true);
    expect(where("NAME LIKE 'ber%'", p)).toBe(true);
    expect(where("NAME LIKE '%lin'", p)).toBe(true);
    expect(where("NAME LIKE 'B_rlin'", p)).toBe(true);
    expect(where("NAME LIKE 'B_lin'", p)).toBe(false);
    expect(where("NAME NOT LIKE 'X%'", p)).toBe(true);
    expect(where("NAME NOT LIKE 'B%'", p)).toBe(false);
    expect(where("N LIKE '%'", p)).toBe(false);
    expect(where("NAME LIKE 'a.c'", { NAME: 'abc' })).toBe(false);
    expect(where("NAME LIKE 'a.c'", { NAME: 'a.c' })).toBe(true);
    expect(where('NAME LIKE P', { NAME: 'abc', P: 'a%' })).toBe(true);
  });
  it('IN / NOT IN', () => {
    expect(where("NAME IN ('Paris', 'Berlin')", p)).toBe(true);
    expect(where("NAME IN ('Paris')", p)).toBe(false);
    expect(where("NAME NOT IN ('Paris')", p)).toBe(true);
    expect(where('POP IN (1, 500, 3)', p)).toBe(true);
    expect(where('N IN (1)', p)).toBe(false);
    expect(where('N NOT IN (1)', p)).toBe(false);
  });
  it('IS NULL / IS NOT NULL', () => {
    expect(where('N IS NULL', p)).toBe(true);
    expect(where('NAME IS NULL', p)).toBe(false);
    expect(where('NAME IS NOT NULL', p)).toBe(true);
    expect(where('Nope IS NULL', p)).toBe(true);
  });
  it('BETWEEN', () => {
    expect(where('POP BETWEEN 100 AND 1000', p)).toBe(true);
    expect(where('POP BETWEEN 600 AND 1000', p)).toBe(false);
    expect(where('POP NOT BETWEEN 600 AND 1000', p)).toBe(true);
    expect(where('POP BETWEEN 100 AND 1000 AND NAME = "Berlin"', p)).toBe(true);
    expect(where('N BETWEEN 1 AND 2', p)).toBe(false);
  });
  it('dates compare as ISO strings', () => {
    expect(where("D > '2020-01-01'", { D: '2021-05-05' })).toBe(true);
    expect(where("D BETWEEN '2020-01-01' AND '2020-12-31'", { D: '2020-06-01' })).toBe(true);
  });
  it('empty where matches everything', () => {
    expect(where('')).toBe(true);
  });
  it('where returns strictly boolean', () => {
    expect(compileWhere('POP')(feat({ POP: 5 }))).toBe(true);
    expect(compileWhere('POP')(feat({ POP: 0 }))).toBe(false);
    expect(compileWhere('Missing')(feat({}))).toBe(false);
  });
});

describe('math functions', () => {
  it('basic', () => {
    expect(ev('Round(2.5)')).toBe(3);
    expect(ev('Round(-2.5)')).toBe(-3);
    expect(ev('Round(1.005, 2)')).toBe(1.01);
    expect(ev('Round(3.14159, 3)')).toBe(3.142);
    expect(ev('round(POP / 1e6, 1)', { POP: 2_340_000 })).toBe(2.3);
    expect(ev('Abs(-4)')).toBe(4);
    expect(ev('Floor(2.7)')).toBe(2);
    expect(ev('Ceil(2.1)')).toBe(3);
    expect(ev('Sqrt(16)')).toBe(4);
    expect(ev('Sqrt(-1)')).toBeNull();
    expect(ev('Pow(2, 10)')).toBe(1024);
    expect(ev('Exp(0)')).toBe(1);
    expect(ev('Log(1)')).toBe(0);
    expect(ev('Min(3, 1, 2)')).toBe(1);
    expect(ev('Max(3, 1, 2)')).toBe(3);
    expect(ev('Max(A, 5)', { A: null })).toBe(5);
    expect(ev('Sin(0)')).toBe(0);
    expect(ev('Cos(0)')).toBe(1);
    expect(ev('Tan(0)')).toBe(0);
    expect(ev('Pi()')).toBeCloseTo(Math.PI);
    const r = ev('Random()');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });
  it('null in, null out', () => {
    expect(ev('Round(A, 1)', { A: null })).toBeNull();
  });
});

describe('text functions', () => {
  it('basic', () => {
    expect(ev("Upper('abc')")).toBe('ABC');
    expect(ev("Lower('ABC')")).toBe('abc');
    expect(ev("Trim('  x ')")).toBe('x');
    expect(ev("Length('hello')")).toBe(5);
    expect(ev('Length(NAME)', { NAME: 'abcd' })).toBe(4);
    expect(ev("Left('hello', 2)")).toBe('he');
    expect(ev("Right('hello', 2)")).toBe('lo');
    expect(ev("Mid('hello', 2, 3)")).toBe('ell');
    expect(ev("Mid('hello', 3)")).toBe('llo');
    expect(ev("Replace('a-b-c', '-', '+')")).toBe('a+b+c');
    expect(ev("Concatenate('a', 1, null, 'b')")).toBe('a1b');
    expect(ev("Find('l', 'hello')")).toBe(3);
    expect(ev("Find('z', 'hello')")).toBe(0);
    expect(ev("Proper('hello wORLD o''brien')")).toBe("Hello World O'Brien");
    expect(ev('Text(3.14159, 2)')).toBe('3.14');
    expect(ev('Text(5)')).toBe('5');
    expect(ev('Number(A)', { A: ' 12.5 ' })).toBe(12.5);
    expect(ev("Number('abc')")).toBeNull();
    expect(ev("Contains('Hello', 'ELL')")).toBe(true);
  });
  it('label-style expression', () => {
    expect(ev('NAME + " (" + Round(POP/1e6, 1) + "M)"', { NAME: 'Rome', POP: 2_870_000 })).toBe('Rome (2.9M)');
  });
});

describe('logic functions', () => {
  it('IsEmpty / DefaultValue / Coalesce', () => {
    expect(ev('IsEmpty(A)', { A: '' })).toBe(true);
    expect(ev('IsEmpty(A)', { A: 'x' })).toBe(false);
    expect(ev('IsEmpty(A)', {})).toBe(true);
    expect(ev("DefaultValue(A, 'n/a')", { A: null })).toBe('n/a');
    expect(ev("DefaultValue(A, 'n/a')", { A: 'v' })).toBe('v');
    expect(ev('Coalesce(A, B, 3)', { A: null, B: '' })).toBe(3);
    expect(ev('Coalesce(A, B, 3)', { A: null, B: 2 })).toBe(2);
  });
  it('IIf / When', () => {
    expect(ev("IIf(POP > 10, 'big', 'small')", { POP: 11 })).toBe('big');
    expect(ev("IIf(POP > 10, 'big', 'small')", { POP: 1 })).toBe('small');
    expect(ev("When(POP < 10, 'S', POP < 100, 'M', 'L')", { POP: 50 })).toBe('M');
    expect(ev("When(POP < 10, 'S', POP < 100, 'M', 'L')", { POP: 500 })).toBe('L');
    expect(ev("When(POP < 10, 'S')", { POP: 500 })).toBeNull();
  });
});

describe('date functions', () => {
  it('Year / Month / Day', () => {
    expect(ev('Year(D)', { D: '2024-03-15' })).toBe(2024);
    expect(ev('Month(D)', { D: '2024-03-15' })).toBe(3);
    expect(ev('Day(D)', { D: '2024-03-15T23:59:00Z' })).toBe(15);
    expect(ev('Year(D)', { D: null })).toBeNull();
    expect(ev("Year('garbage')")).toBeNull();
  });
  it('DateDiff', () => {
    expect(ev("DateDiff('2024-03-15', '2024-03-01', 'days')")).toBe(14);
    expect(ev("DateDiff('2024-03-01', '2024-03-15', 'days')")).toBe(-14);
    expect(ev("DateDiff('2024-03-15', '2024-01-20', 'months')")).toBe(1);
    expect(ev("DateDiff('2026-01-01', '2024-01-01', 'years')")).toBe(2);
    expect(ev("DateDiff('2024-01-01T12:00:00Z', '2024-01-01T00:00:00Z', 'hours')")).toBe(12);
    expect(ev("DateDiff('2024-01-01', '2024-01-01', 'fortnights')")).toBeNull();
  });
  it('Now / Today', () => {
    expect(ev('Now()')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ev('Today()')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ev('Year(Today())')).toBe(new Date().getFullYear());
  });
});

describe('geometry functions', () => {
  it('Area', () => {
    const sqm = ev('Area()', {}, square);
    expect(sqm).toBeGreaterThan(1.2e10);
    expect(sqm).toBeLessThan(1.25e10);
    expect(ev("Area('sqkm')", {}, square)).toBeCloseTo(sqm / 1e6, 3);
    expect(ev("Area('ha')", {}, square)).toBeCloseTo(sqm / 1e4, 0);
    expect(ev("Area('acres')", {}, square)).toBeCloseTo(sqm / 4046.8564224, 0);
    expect(ev("Area('sqmi')", {}, square)).toBeCloseTo(sqm / 2589988.11, 1);
    expect(ev("Area('bogus')", {}, square)).toBeNull();
    expect(ev('Area()', {}, { type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(ev('Area()')).toBeNull();
  });
  it('Length', () => {
    const line = { type: 'LineString', coordinates: [[0, 0], [1, 0]] };
    const m = ev('Length()', {}, line);
    expect(m).toBeGreaterThan(111000);
    expect(m).toBeLessThan(112500);
    expect(ev("Length('km')", {}, line)).toBeCloseTo(m / 1000, 3);
    expect(ev("Length('mi')", {}, line)).toBeCloseTo(m / 1609.344, 3);
    expect(ev("Length('ft')", {}, line)).toBeCloseTo(m / 0.3048, 0);
    const perim = ev("Length('km')", {}, square);
    expect(perim).toBeGreaterThan(440);
    expect(perim).toBeLessThan(450);
    // text length still works when the argument is not a unit literal
    expect(ev('Length(NAME)', { NAME: 'km' })).toBe(2);
    expect(ev("Length('km')", { NAME: 'x' })).toBeNull();
  });
  it('X / Y / PointCount / FID', () => {
    expect(ev('X()', {}, square)).toBeCloseTo(0.5, 5);
    expect(ev('Y()', {}, { type: 'Point', coordinates: [12, 34] })).toBe(34);
    expect(ev('X()', {}, { type: 'Point', coordinates: [12, 34] })).toBe(12);
    expect(ev('PointCount()', {}, square)).toBe(5);
    expect(ev('X()')).toBeNull();
    expect(compileExpr('FID()')(feat({}, null, 7))).toBe(7);
  });
});

describe('errors', () => {
  it('syntax errors throw ExprError with position', () => {
    for (const bad of ['1 +', '(1', '1 2', "'abc", 'POP >', 'a LIKE', 'a IN 1', 'a BETWEEN 1', 'a IS 3', '[abc', '1 @ 2', ')', 'AND', '$feature']) {
      expect(() => compileExpr(bad), bad).toThrow(ExprError);
    }
    try {
      compileExpr('1 +');
    } catch (e: any) {
      expect(typeof e.position).toBe('number');
    }
  });
  it('unknown function and arity are compile errors', () => {
    expect(() => compileExpr('Nope(1)')).toThrow(/Unknown function/);
    expect(() => compileExpr('Round()')).toThrow(/expects/);
    expect(() => compileExpr('Round(1,2,3)')).toThrow(/expects/);
    expect(() => compileExpr('Pi(1)')).toThrow(/expects/);
  });
  it('tryCompile', () => {
    expect(tryCompile('1 + 1').fn).toBeTypeOf('function');
    expect(tryCompile('1 +').error).toBeTruthy();
    expect(tryCompile('1 +').fn).toBeUndefined();
  });
  it('evaluation never throws', () => {
    expect(ev('A + B', { A: {}, B: [] })).toBeNull();
    expect(compileExpr('Area()')({ properties: null })).toBeNull();
    expect(compileExpr('A')({ properties: null })).toBeNull();
    expect(ev('Area()', {}, { type: 'Polygon', coordinates: [] })).not.toBeUndefined();
  });
});

describe('listFunctions', () => {
  it('documents everything', () => {
    const fns = listFunctions();
    const names = fns.map((f) => f.name);
    for (const n of ['Round', 'Upper', 'IIf', 'When', 'Coalesce', 'DateDiff', 'Area', 'Length', 'X', 'Y', 'PointCount', 'FID', 'Proper', 'Text', 'Today']) {
      expect(names, n).toContain(n);
    }
    for (const f of fns) {
      expect(f.signature.startsWith(f.name + '(')).toBe(true);
      expect(f.description.length).toBeGreaterThan(3);
      expect(f.category).toBeTruthy();
    }
    expect(new Set(fns.map((f) => f.category)).size).toBeGreaterThanOrEqual(4);
  });
  it('every documented signature compiles with its minimal arity', () => {
    for (const f of listFunctions()) {
      const params = f.signature.slice(f.signature.indexOf('(') + 1, -1).split(',').map((s) => s.trim()).filter((s) => s && !s.endsWith('?') && s !== '...');
      const call = `${f.name}(${params.map(() => '1').join(', ')})`;
      expect(() => compileExpr(call), call).not.toThrow();
    }
  });
});
