/**
 * FormulaEngine.js — Excel-like formula parser for BOQ cells
 *
 * Supports:
 *   - Cell references: A1, B3, C12 (column letter + row number)
 *   - Range references: A1:A10, B2:D5
 *   - Arithmetic: + - * / ^ () with proper precedence
 *   - Functions: SUM, AVERAGE, MIN, MAX, IF, AND, OR, NOT, ROUND, FLOOR, CEIL,
 *                ABS, SQRT, MOD, MARKUP, WASTAGE, RATE, LEN, CONCAT, NOW, TODAY
 *   - Literal values: numbers, strings ("text"), booleans (TRUE/FALSE)
 *   - Error propagation: #REF!, #DIV/0!, #VALUE!, #CIRC!
 *
 * Usage:
 *   const engine = new FormulaEngine(cellProvider);
 *   const result = engine.evaluate('=SUM(A1:A5) * MARKUP(B1, 15)');
 */

'use strict';

// ─── Token types ────────────────────────────────────────────────────────────
const TK = {
  NUMBER:   'NUMBER',
  STRING:   'STRING',
  BOOL:     'BOOL',
  CELL_REF: 'CELL_REF',
  RANGE:    'RANGE',
  FUNC:     'FUNC',
  COMMA:    'COMMA',
  LPAREN:   'LPAREN',
  RPAREN:   'RPAREN',
  PLUS:     'PLUS',
  MINUS:    'MINUS',
  STAR:     'STAR',
  SLASH:    'SLASH',
  CARET:    'CARET',
  PERCENT:  'PERCENT',
  AMPERSAND:'AMPERSAND',
  LT:       'LT',
  LTE:      'LTE',
  GT:       'GT',
  GTE:      'GTE',
  EQ:       'EQ',
  NEQ:      'NEQ',
  EOF:      'EOF',
};

// ─── Formula errors ──────────────────────────────────────────────────────────
class FormulaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;           // '#REF!', '#DIV/0!', '#VALUE!', '#CIRC!'
    this.isFormulaError = true;
  }
}

const ERR = {
  ref   : (msg) => new FormulaError('#REF!',   msg || 'Invalid cell reference'),
  div0  : ()    => new FormulaError('#DIV/0!', 'Division by zero'),
  value : (msg) => new FormulaError('#VALUE!', msg || 'Invalid value'),
  circ  : (ref) => new FormulaError('#CIRC!',  `Circular reference: ${ref}`),
  name  : (fn)  => new FormulaError('#NAME?',  `Unknown function: ${fn}`),
  na    : ()    => new FormulaError('#N/A',    'Value not available'),
};

// ─── Lexer ───────────────────────────────────────────────────────────────────
class Lexer {
  constructor(src) {
    this.src = src.trim();
    this.pos = 0;
    this.tokens = [];
    this._tokenize();
    this.idx = 0;
  }

  peek()    { return this.tokens[this.idx] || { type: TK.EOF }; }
  consume() { return this.tokens[this.idx++] || { type: TK.EOF }; }
  expect(type) {
    const t = this.consume();
    if (t.type !== type) throw ERR.value(`Expected ${type}, got ${t.type}`);
    return t;
  }

  _tokenize() {
    const src = this.src;
    let i = this.pos;

    while (i < src.length) {
      // skip whitespace
      if (/\s/.test(src[i])) { i++; continue; }

      // string literal
      if (src[i] === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== '"') {
          if (src[j] === '\\') j++;  // escape
          j++;
        }
        this.tokens.push({ type: TK.STRING, value: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }

      // number (int or float, optional leading minus handled by parser)
      if (/[0-9]/.test(src[i]) || (src[i] === '.' && /[0-9]/.test(src[i + 1]))) {
        let j = i;
        while (j < src.length && /[0-9._]/.test(src[j])) j++;
        // scientific notation
        if (j < src.length && /[eE]/.test(src[j])) {
          j++;
          if (j < src.length && /[+-]/.test(src[j])) j++;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
        }
        const raw = src.slice(i, j).replace(/_/g, '');
        this.tokens.push({ type: TK.NUMBER, value: parseFloat(raw) });
        i = j;
        continue;
      }

      // identifiers: function names, TRUE, FALSE, cell refs (A1, AB12, A1:B5)
      if (/[A-Za-z]/.test(src[i])) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j);
        const upperWord = word.toUpperCase();

        if (upperWord === 'TRUE')  { this.tokens.push({ type: TK.BOOL, value: true  }); i = j; continue; }
        if (upperWord === 'FALSE') { this.tokens.push({ type: TK.BOOL, value: false }); i = j; continue; }

        // Check for cell ref (e.g. A1, B12, AB3)
        const isCellRef = /^[A-Z]{1,3}[0-9]+$/.test(upperWord);

        // Check for range: A1:B5 — peek ahead
        if (isCellRef && j < src.length && src[j] === ':') {
          let k = j + 1;
          while (k < src.length && /[A-Za-z0-9]/.test(src[k])) k++;
          const right = src.slice(j + 1, k).toUpperCase();
          if (/^[A-Z]{1,3}[0-9]+$/.test(right)) {
            this.tokens.push({ type: TK.RANGE, value: `${upperWord}:${right}` });
            i = k;
            continue;
          }
        }

        if (isCellRef) {
          this.tokens.push({ type: TK.CELL_REF, value: upperWord });
        } else if (j < src.length && src[j] === '(') {
          this.tokens.push({ type: TK.FUNC, value: upperWord });
        } else {
          // treat as cell ref attempt — will fail at eval if invalid
          this.tokens.push({ type: TK.CELL_REF, value: upperWord });
        }
        i = j;
        continue;
      }

      // single/double char operators
      switch (src[i]) {
        case '+': this.tokens.push({ type: TK.PLUS   }); break;
        case '-': this.tokens.push({ type: TK.MINUS  }); break;
        case '*': this.tokens.push({ type: TK.STAR   }); break;
        case '/': this.tokens.push({ type: TK.SLASH  }); break;
        case '^': this.tokens.push({ type: TK.CARET  }); break;
        case '%': this.tokens.push({ type: TK.PERCENT}); break;
        case '&': this.tokens.push({ type: TK.AMPERSAND }); break;
        case ',': this.tokens.push({ type: TK.COMMA  }); break;
        case '(': this.tokens.push({ type: TK.LPAREN }); break;
        case ')': this.tokens.push({ type: TK.RPAREN }); break;
        case '<':
          if (src[i + 1] === '=') { this.tokens.push({ type: TK.LTE }); i += 2; continue; }
          if (src[i + 1] === '>') { this.tokens.push({ type: TK.NEQ }); i += 2; continue; }
          this.tokens.push({ type: TK.LT }); break;
        case '>':
          if (src[i + 1] === '=') { this.tokens.push({ type: TK.GTE }); i += 2; continue; }
          this.tokens.push({ type: TK.GT }); break;
        case '=':
          if (src[i + 1] === '=') { this.tokens.push({ type: TK.EQ }); i += 2; continue; }
          this.tokens.push({ type: TK.EQ }); break;
        default:
          throw ERR.value(`Unexpected character: "${src[i]}" at position ${i}`);
      }
      i++;
    }
  }
}

// ─── Parser (recursive descent → AST) ───────────────────────────────────────
class Parser {
  constructor(lexer) { this.lex = lexer; }

  parse() {
    const node = this._parseComparison();
    if (this.lex.peek().type !== TK.EOF) {
      throw ERR.value('Unexpected token after expression');
    }
    return node;
  }

  // comparison: expr (< <= > >= = <>) expr
  _parseComparison() {
    let left = this._parseConcat();
    const ops = { [TK.LT]: '<', [TK.LTE]: '<=', [TK.GT]: '>', [TK.GTE]: '>=', [TK.EQ]: '=', [TK.NEQ]: '<>' };
    while (ops[this.lex.peek().type]) {
      const op = ops[this.lex.consume().type];
      const right = this._parseConcat();
      left = { type: 'BinOp', op, left, right };
    }
    return left;
  }

  // string concat: additive (&) additive
  _parseConcat() {
    let left = this._parseAdditive();
    while (this.lex.peek().type === TK.AMPERSAND) {
      this.lex.consume();
      const right = this._parseAdditive();
      left = { type: 'Concat', left, right };
    }
    return left;
  }

  // additive: multiplicative ((+ | -) multiplicative)*
  _parseAdditive() {
    let left = this._parseMultiplicative();
    while (this.lex.peek().type === TK.PLUS || this.lex.peek().type === TK.MINUS) {
      const op = this.lex.consume().type === TK.PLUS ? '+' : '-';
      const right = this._parseMultiplicative();
      left = { type: 'BinOp', op, left, right };
    }
    return left;
  }

  // multiplicative: exponent ((* | /) exponent)*
  _parseMultiplicative() {
    let left = this._parsePercent();
    while (this.lex.peek().type === TK.STAR || this.lex.peek().type === TK.SLASH) {
      const op = this.lex.consume().type === TK.STAR ? '*' : '/';
      const right = this._parsePercent();
      left = { type: 'BinOp', op, left, right };
    }
    return left;
  }

  // percent: exponent (% optional)
  _parsePercent() {
    let node = this._parseExponent();
    if (this.lex.peek().type === TK.PERCENT) {
      this.lex.consume();
      node = { type: 'BinOp', op: '/', left: node, right: { type: 'Literal', value: 100 } };
    }
    return node;
  }

  // exponent: unary (^ unary)*
  _parseExponent() {
    let left = this._parseUnary();
    while (this.lex.peek().type === TK.CARET) {
      this.lex.consume();
      const right = this._parseUnary();
      left = { type: 'BinOp', op: '^', left, right };
    }
    return left;
  }

  // unary: -atom | +atom | atom
  _parseUnary() {
    if (this.lex.peek().type === TK.MINUS) {
      this.lex.consume();
      return { type: 'Unary', op: '-', operand: this._parseUnary() };
    }
    if (this.lex.peek().type === TK.PLUS) {
      this.lex.consume();
      return this._parseUnary();
    }
    return this._parseAtom();
  }

  // atom: literal | cellRef | range | func(...) | (expr)
  _parseAtom() {
    const t = this.lex.peek();

    if (t.type === TK.NUMBER) { this.lex.consume(); return { type: 'Literal', value: t.value }; }
    if (t.type === TK.STRING) { this.lex.consume(); return { type: 'Literal', value: t.value }; }
    if (t.type === TK.BOOL)   { this.lex.consume(); return { type: 'Literal', value: t.value }; }

    if (t.type === TK.CELL_REF) {
      this.lex.consume();
      return { type: 'CellRef', ref: t.value };
    }

    if (t.type === TK.RANGE) {
      this.lex.consume();
      return { type: 'Range', ref: t.value };
    }

    if (t.type === TK.FUNC) {
      this.lex.consume();
      this.lex.expect(TK.LPAREN);
      const args = [];
      if (this.lex.peek().type !== TK.RPAREN) {
        args.push(this._parseComparison());
        while (this.lex.peek().type === TK.COMMA) {
          this.lex.consume();
          args.push(this._parseComparison());
        }
      }
      this.lex.expect(TK.RPAREN);
      return { type: 'Call', fn: t.value, args };
    }

    if (t.type === TK.LPAREN) {
      this.lex.consume();
      const expr = this._parseComparison();
      this.lex.expect(TK.RPAREN);
      return expr;
    }

    throw ERR.value(`Unexpected token: ${t.type} ("${t.value ?? ''}")`);
  }
}

// ─── Evaluator ───────────────────────────────────────────────────────────────
class Evaluator {
  /**
   * @param {Function} cellProvider - (ref: string) => number | string | null
   *   Called to resolve cell references like "A1". Must throw ERR.ref() for invalid refs.
   * @param {Function} rangeProvider - (range: string) => (number|string)[]
   *   Called to resolve ranges like "A1:B5". Default built from cellProvider.
   */
  constructor(cellProvider, rangeProvider = null, circularGuard = new Set()) {
    this._getCell  = cellProvider  || (() => 0);
    this._getRange = rangeProvider || ((range) => this._defaultRange(range));
    this._circular = circularGuard;
  }

  _defaultRange(range) {
    const [startRef, endRef] = range.split(':');
    const startCol = this._colIndex(startRef.match(/^[A-Z]+/)[0]);
    const startRow = parseInt(startRef.match(/[0-9]+$/)[0]);
    const endCol   = this._colIndex(endRef.match(/^[A-Z]+/)[0]);
    const endRow   = parseInt(endRef.match(/[0-9]+$/)[0]);

    const values = [];
    for (let r = Math.min(startRow, endRow); r <= Math.max(startRow, endRow); r++) {
      for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
        values.push(this._getCell(this._colLetter(c) + r));
      }
    }
    return values;
  }

  _colIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  _colLetter(n) {
    let s = '';
    while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  eval(node) {
    switch (node.type) {
      case 'Literal':  return node.value;
      case 'CellRef':  return this._resolveCell(node.ref);
      case 'Range':    return this._getRange(node.ref);
      case 'Unary':    return this._evalUnary(node);
      case 'BinOp':    return this._evalBinOp(node);
      case 'Concat':   return String(this.eval(node.left)) + String(this.eval(node.right));
      case 'Call':     return this._evalCall(node);
      default:         throw ERR.value(`Unknown AST node: ${node.type}`);
    }
  }

  _resolveCell(ref) {
    if (this._circular.has(ref)) throw ERR.circ(ref);
    this._circular.add(ref);
    try {
      const val = this._getCell(ref);
      return val == null ? 0 : val;
    } finally {
      this._circular.delete(ref);
    }
  }

  _evalUnary({ op, operand }) {
    const v = this.eval(operand);
    if (typeof v !== 'number') throw ERR.value(`Unary ${op} applied to non-number`);
    return op === '-' ? -v : v;
  }

  _evalBinOp({ op, left, right }) {
    const l = this.eval(left);
    const r = this.eval(right);

    if (op === '+') {
      if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
      return this._num(l) + this._num(r);
    }
    if (op === '-') return this._num(l) - this._num(r);
    if (op === '*') return this._num(l) * this._num(r);
    if (op === '/') {
      const denominator = this._num(r);
      if (denominator === 0) throw ERR.div0();
      return this._num(l) / denominator;
    }
    if (op === '^') return Math.pow(this._num(l), this._num(r));
    if (op === '<')  return l < r;
    if (op === '<=') return l <= r;
    if (op === '>')  return l > r;
    if (op === '>=') return l >= r;
    if (op === '=' || op === '==') return l == r;   // loose equality like Excel
    if (op === '<>') return l != r;
    throw ERR.value(`Unknown operator: ${op}`);
  }

  _num(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (isNaN(n)) throw ERR.value(`Cannot convert "${v}" to number`);
      return n;
    }
    if (typeof v !== 'number') throw ERR.value(`Expected number, got ${typeof v}`);
    return v;
  }

  _flatNumbers(args) {
    const nums = [];
    for (const arg of args) {
      const v = this.eval(arg);
      const flat = Array.isArray(v) ? v : [v];
      for (const item of flat) {
        const n = parseFloat(item);
        if (!isNaN(n)) nums.push(n);
      }
    }
    return nums;
  }

  _evalCall({ fn, args }) {
    switch (fn) {
      // ── Aggregate ──
      case 'SUM': {
        const nums = this._flatNumbers(args);
        return nums.reduce((a, b) => a + b, 0);
      }
      case 'AVERAGE': {
        const nums = this._flatNumbers(args);
        if (nums.length === 0) throw ERR.div0();
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }
      case 'MIN': {
        const nums = this._flatNumbers(args);
        return nums.length ? Math.min(...nums) : 0;
      }
      case 'MAX': {
        const nums = this._flatNumbers(args);
        return nums.length ? Math.max(...nums) : 0;
      }
      case 'COUNT': {
        const vals = args.flatMap(a => { const v = this.eval(a); return Array.isArray(v) ? v : [v]; });
        return vals.filter(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(parseFloat(v)))).length;
      }
      case 'COUNTA': {
        const vals = args.flatMap(a => { const v = this.eval(a); return Array.isArray(v) ? v : [v]; });
        return vals.filter(v => v != null && v !== '').length;
      }

      // ── Math ──
      case 'ROUND': {
        if (args.length < 1) throw ERR.value('ROUND requires at least 1 argument');
        const v   = this._num(this.eval(args[0]));
        const dp  = args[1] ? this._num(this.eval(args[1])) : 0;
        return Math.round(v * 10 ** dp) / 10 ** dp;
      }
      case 'ROUNDUP': {
        const v  = this._num(this.eval(args[0]));
        const dp = args[1] ? this._num(this.eval(args[1])) : 0;
        return Math.ceil(v * 10 ** dp) / 10 ** dp;
      }
      case 'ROUNDDOWN': {
        const v  = this._num(this.eval(args[0]));
        const dp = args[1] ? this._num(this.eval(args[1])) : 0;
        return Math.floor(v * 10 ** dp) / 10 ** dp;
      }
      case 'FLOOR': {
        const v    = this._num(this.eval(args[0]));
        const sig  = args[1] ? this._num(this.eval(args[1])) : 1;
        return Math.floor(v / sig) * sig;
      }
      case 'CEILING':
      case 'CEIL': {
        const v    = this._num(this.eval(args[0]));
        const sig  = args[1] ? this._num(this.eval(args[1])) : 1;
        return Math.ceil(v / sig) * sig;
      }
      case 'ABS':  return Math.abs(this._num(this.eval(args[0])));
      case 'SQRT': {
        const v = this._num(this.eval(args[0]));
        if (v < 0) throw ERR.value('SQRT of negative number');
        return Math.sqrt(v);
      }
      case 'MOD': {
        const a = this._num(this.eval(args[0]));
        const b = this._num(this.eval(args[1]));
        if (b === 0) throw ERR.div0();
        return a - Math.floor(a / b) * b;
      }
      case 'POWER':
      case 'POW': {
        return Math.pow(this._num(this.eval(args[0])), this._num(this.eval(args[1])));
      }
      case 'INT': return Math.trunc(this._num(this.eval(args[0])));
      case 'LN':  return Math.log(this._num(this.eval(args[0])));
      case 'LOG': {
        const v    = this._num(this.eval(args[0]));
        const base = args[1] ? this._num(this.eval(args[1])) : 10;
        return Math.log(v) / Math.log(base);
      }
      case 'EXP': return Math.exp(this._num(this.eval(args[0])));
      case 'PI':  return Math.PI;

      // ── Logic ──
      case 'IF': {
        if (args.length < 2) throw ERR.value('IF requires at least 2 arguments');
        const cond = this.eval(args[0]);
        return cond ? this.eval(args[1]) : (args[2] ? this.eval(args[2]) : false);
      }
      case 'IFS': {
        for (let i = 0; i < args.length - 1; i += 2) {
          if (this.eval(args[i])) return this.eval(args[i + 1]);
        }
        return args.length % 2 === 1 ? this.eval(args[args.length - 1]) : ERR.na();
      }
      case 'AND': return args.every(a => Boolean(this.eval(a)));
      case 'OR':  return args.some(a  => Boolean(this.eval(a)));
      case 'NOT': return !Boolean(this.eval(args[0]));
      case 'IFERROR': {
        try { return this.eval(args[0]); }
        catch (e) { return args[1] ? this.eval(args[1]) : ''; }
      }
      case 'ISBLANK': {
        const v = this.eval(args[0]);
        return v == null || v === '';
      }
      case 'ISNUMBER': return typeof this.eval(args[0]) === 'number';
      case 'ISTEXT':   return typeof this.eval(args[0]) === 'string';

      // ── String ──
      case 'LEN':    return String(this.eval(args[0])).length;
      case 'TRIM':   return String(this.eval(args[0])).trim();
      case 'UPPER':  return String(this.eval(args[0])).toUpperCase();
      case 'LOWER':  return String(this.eval(args[0])).toLowerCase();
      case 'CONCAT':
      case 'CONCATENATE': {
        return args.map(a => { const v = this.eval(a); return Array.isArray(v) ? v.join('') : String(v); }).join('');
      }
      case 'TEXT': {
        const v   = this._num(this.eval(args[0]));
        const fmt = String(this.eval(args[1]));
        return this._formatNumber(v, fmt);
      }
      case 'VALUE': {
        const s = String(this.eval(args[0])).replace(/,/g, '');
        const n = parseFloat(s);
        if (isNaN(n)) throw ERR.value(`Cannot convert to number: "${s}"`);
        return n;
      }
      case 'LEFT': {
        const s = String(this.eval(args[0]));
        const n = args[1] ? this._num(this.eval(args[1])) : 1;
        return s.slice(0, n);
      }
      case 'RIGHT': {
        const s = String(this.eval(args[0]));
        const n = args[1] ? this._num(this.eval(args[1])) : 1;
        return s.slice(-n);
      }
      case 'MID': {
        const s   = String(this.eval(args[0]));
        const pos = this._num(this.eval(args[1])) - 1;  // 1-indexed
        const len = this._num(this.eval(args[2]));
        return s.slice(pos, pos + len);
      }

      // ── Date/Time ──
      case 'NOW':   return new Date().toISOString();
      case 'TODAY': return new Date().toISOString().slice(0, 10);
      case 'YEAR':  { const d = new Date(this.eval(args[0])); return d.getFullYear(); }
      case 'MONTH': { const d = new Date(this.eval(args[0])); return d.getMonth() + 1; }
      case 'DAY':   { const d = new Date(this.eval(args[0])); return d.getDate(); }
      case 'DAYS': {
        const d1 = new Date(this.eval(args[0]));
        const d2 = new Date(this.eval(args[1]));
        return Math.round((d2 - d1) / 86400000);
      }

      // ── Construction-specific ──
      /**
       * MARKUP(value, pct) — add percentage markup
       *   MARKUP(1000, 15) → 1150
       */
      case 'MARKUP': {
        if (args.length < 2) throw ERR.value('MARKUP(value, pct%) requires 2 arguments');
        const value  = this._num(this.eval(args[0]));
        const pct    = this._num(this.eval(args[1]));
        return value * (1 + pct / 100);
      }

      /**
       * WASTAGE(qty, pct) — add wastage allowance
       *   WASTAGE(100, 5) → 105
       */
      case 'WASTAGE': {
        if (args.length < 2) throw ERR.value('WASTAGE(qty, pct%) requires 2 arguments');
        const qty = this._num(this.eval(args[0]));
        const pct = this._num(this.eval(args[1]));
        return qty * (1 + pct / 100);
      }

      /**
       * NET_AREA(length, width, deductions) — area minus openings
       *   NET_AREA(10, 5, 2.5) → 47.5
       */
      case 'NET_AREA': {
        const l   = this._num(this.eval(args[0]));
        const w   = this._num(this.eval(args[1]));
        const ded = args[2] ? this._num(this.eval(args[2])) : 0;
        return Math.max(0, l * w - ded);
      }

      /**
       * RATE(unit_rate, qty) — extended amount
       *   RATE(450, 120) → 54000
       */
      case 'RATE': {
        const rate = this._num(this.eval(args[0]));
        const qty  = this._num(this.eval(args[1]));
        return rate * qty;
      }

      /**
       * VOLUME(l, w, h) — cubic quantity
       *   VOLUME(10, 5, 0.3) → 15
       */
      case 'VOLUME': {
        const l = this._num(this.eval(args[0]));
        const w = this._num(this.eval(args[1]));
        const h = this._num(this.eval(args[2]));
        return l * w * h;
      }

      /**
       * PERIMETER(l, w) — 2*(l+w)
       */
      case 'PERIMETER': {
        const l = this._num(this.eval(args[0]));
        const w = this._num(this.eval(args[1]));
        return 2 * (l + w);
      }

      /**
       * UNIT_CONVERT(value, from, to) — unit conversion
       *   UNIT_CONVERT(1, "m", "mm") → 1000
       */
      case 'UNIT_CONVERT': {
        const value = this._num(this.eval(args[0]));
        const from  = String(this.eval(args[1])).toLowerCase();
        const to    = String(this.eval(args[2])).toLowerCase();
        return value * this._unitConvert(from, to);
      }

      /**
       * REBAR_WEIGHT(dia_mm, length_m) — unit weight of rebar in kg
       *   REBAR_WEIGHT(16, 12) → 18.98
       */
      case 'REBAR_WEIGHT': {
        const dia = this._num(this.eval(args[0]));   // mm
        const len = this._num(this.eval(args[1]));   // m
        // Unit weight = (d²/162) kg/m  (standard formula)
        return (dia * dia / 162) * len;
      }

      /**
       * CONCRETE_VOL(l, w, d) — volume in m³
       */
      case 'CONCRETE_VOL': {
        const l = this._num(this.eval(args[0]));
        const w = this._num(this.eval(args[1]));
        const d = this._num(this.eval(args[2]));
        return l * w * d;
      }

      /**
       * LINTEL(span_m) — nominal lintel length with 150mm bearing each side
       *   LINTEL(1.2) → 1.5
       */
      case 'LINTEL': {
        const span = this._num(this.eval(args[0]));
        return span + 0.15 * 2;
      }

      default:
        throw ERR.name(fn);
    }
  }

  _formatNumber(v, fmt) {
    // Basic number format patterns: "0.00", "#,##0.00", "0%"
    if (fmt.endsWith('%')) return (v * 100).toFixed(2) + '%';
    const dp = (fmt.split('.')[1] || '').replace(/[^0#]/g, '').length;
    if (fmt.includes(',')) {
      return v.toLocaleString('en-UG', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    }
    return v.toFixed(dp);
  }

  _unitConvert(from, to) {
    // convert to base SI then to target
    const toSI = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };
    const f = toSI[from], t = toSI[to];
    if (!f || !t) throw ERR.value(`Unknown unit: ${from} or ${to}`);
    return f / t;
  }
}

// ─── Public FormulaEngine class ───────────────────────────────────────────────
class FormulaEngine {
  /**
   * @param {Object} options
   * @param {Function} options.cellProvider  - (ref: string) => value
   * @param {Function} options.rangeProvider - (range: string) => value[]
   */
  constructor({ cellProvider = null, rangeProvider = null } = {}) {
    this._cellProvider  = cellProvider;
    this._rangeProvider = rangeProvider;
  }

  /**
   * Evaluate a formula string.
   * @param {string} formula   - e.g. "=SUM(A1:A5)*1.15" or "=MARKUP(B3,15)"
   * @param {Object} overrides - { 'A1': 100, 'B3': 450 } (optional cell overrides)
   * @returns {number|string|boolean} — evaluated result
   */
  evaluate(formula, overrides = {}) {
    if (typeof formula !== 'string') return formula;

    const expr = formula.startsWith('=') ? formula.slice(1) : formula;
    if (!expr.trim()) return '';

    try {
      const lexer  = new Lexer(expr);
      const parser = new Parser(lexer);
      const ast    = parser.parse();

      const cellProvider = (ref) => {
        if (ref in overrides) return overrides[ref];
        if (this._cellProvider) return this._cellProvider(ref);
        throw ERR.ref(`Cell ${ref} not found`);
      };

      const evaluator = new Evaluator(cellProvider, this._rangeProvider);
      return evaluator.eval(ast);
    } catch (e) {
      if (e.isFormulaError) return e.code;   // return error string like Excel
      return '#ERROR!';
    }
  }

  /**
   * Evaluate a formula and return a detailed result object.
   */
  evaluateDetailed(formula, overrides = {}) {
    if (typeof formula !== 'string') return { value: formula, error: null };

    const expr = formula.startsWith('=') ? formula.slice(1) : formula;
    if (!expr.trim()) return { value: '', error: null };

    try {
      const lexer  = new Lexer(expr);
      const parser = new Parser(lexer);
      const ast    = parser.parse();

      const cellProvider = (ref) => {
        if (ref in overrides) return overrides[ref];
        if (this._cellProvider) return this._cellProvider(ref);
        throw ERR.ref(`Cell ${ref} not found`);
      };

      const evaluator = new Evaluator(cellProvider, this._rangeProvider);
      const value     = evaluator.eval(ast);
      return { value, error: null };
    } catch (e) {
      return { value: null, error: e.isFormulaError ? e.code : '#ERROR!', message: e.message };
    }
  }

  /**
   * Validate a formula without evaluating it.
   * Returns { valid: true } or { valid: false, error: string }
   */
  validate(formula) {
    const expr = formula?.startsWith('=') ? formula.slice(1) : formula;
    if (!expr?.trim()) return { valid: true };
    try {
      const lexer  = new Lexer(expr);
      const parser = new Parser(lexer);
      parser.parse();
      return { valid: true };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  /**
   * Extract all cell references from a formula (for dependency tracking).
   * @returns {string[]} e.g. ['A1', 'B3', 'C5']
   */
  extractRefs(formula) {
    const expr = formula?.startsWith('=') ? formula.slice(1) : formula;
    if (!expr?.trim()) return [];

    try {
      const lexer = new Lexer(expr);
      const refs  = new Set();

      for (const token of lexer.tokens) {
        if (token.type === TK.CELL_REF) {
          refs.add(token.value);
        }
        if (token.type === TK.RANGE) {
          // expand range into individual refs for dependency tracking
          const [startRef, endRef] = token.value.split(':');
          refs.add(startRef);
          refs.add(endRef);
        }
      }
      return [...refs];
    } catch {
      return [];
    }
  }

  /**
   * Evaluate all formulas in a BOQ grid simultaneously, resolving dependencies.
   *
   * @param {Array<{ id, colKey, formula, value }>} cells
   *   Each cell: { id: 'A1', colKey: 'quantity', formula: '=B1*C1', value: 0 }
   * @returns {Map<string, number|string>} cellId → computed value
   */
  evaluateGrid(cells) {
    // Build lookup: cellId → cell
    const cellMap = new Map(cells.map(c => [c.id, c]));
    const results = new Map();
    const computing = new Set();

    const resolve = (id) => {
      if (results.has(id)) return results.get(id);
      if (computing.has(id)) throw ERR.circ(id);

      const cell = cellMap.get(id);
      if (!cell) return 0;

      if (!cell.formula || !cell.formula.startsWith('=')) {
        const val = parseFloat(cell.value) || cell.value || 0;
        results.set(id, val);
        return val;
      }

      computing.add(id);
      try {
        const cellProvider = (ref) => resolve(ref);
        const expr     = cell.formula.slice(1);
        const lexer    = new Lexer(expr);
        const parser   = new Parser(lexer);
        const ast      = parser.parse();
        const evaluator = new Evaluator(cellProvider, null, computing);
        const value     = evaluator.eval(ast);
        results.set(id, value);
        return value;
      } catch (e) {
        const errVal = e.isFormulaError ? e.code : '#ERROR!';
        results.set(id, errVal);
        return errVal;
      } finally {
        computing.delete(id);
      }
    };

    for (const cell of cells) resolve(cell.id);
    return results;
  }
}

// ─── BOQ-specific formula evaluation ─────────────────────────────────────────
/**
 * Evaluate a BOQ row's derived fields.
 * Given raw inputs, computes netQuantity, materialCost, labourCost, subtotal, totalCost.
 *
 * @param {Object} row - BOQ item fields
 * @returns {Object} derived values
 */
function computeBOQRow(row, engine = null) {
  const {
    quantity       = 0,
    wastagePercent = 0,
    unitRate       = 0,
    labourRate     = 0,
    labourHours    = 0,
    markupPercent  = 0,
    formulaQty     = null,
    formulaRate    = null,
  } = row;

  const e = engine || new FormulaEngine();

  let resolvedQty  = Number(quantity);
  let resolvedRate = Number(unitRate);

  if (formulaQty  && formulaQty.startsWith('=')) {
    const r = e.evaluate(formulaQty, row._cellMap || {});
    if (typeof r === 'number') resolvedQty = r;
  }
  if (formulaRate && formulaRate.startsWith('=')) {
    const r = e.evaluate(formulaRate, row._cellMap || {});
    if (typeof r === 'number') resolvedRate = r;
  }

  const netQuantity   = resolvedQty * (1 + Number(wastagePercent) / 100);
  const materialCost  = netQuantity * resolvedRate;
  const labourCost    = Number(labourRate) * Number(labourHours);
  const subtotal      = materialCost + labourCost;
  const totalCost     = subtotal * (1 + Number(markupPercent) / 100);

  return {
    netQuantity:  round2(netQuantity),
    materialCost: round2(materialCost),
    labourCost:   round2(labourCost),
    subtotal:     round2(subtotal),
    totalCost:    round2(totalCost),
  };
}

function round2(v) { return Math.round(v * 100) / 100; }

module.exports = { FormulaEngine, computeBOQRow, FormulaError };
