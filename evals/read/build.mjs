#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(HERE, 'tasks.json');

const TASKS = [
  {
    id: 'ts_function_slice',
    lang: 'typescript',
    file: 'src/auth/jwt.ts',
    content: `import jwt from 'jsonwebtoken';
import { User, TokenPayload } from './types';

const SECRET = process.env.JWT_SECRET || 'secret';
const EXPIRES_IN = '1h';

// Generates a new JWT token for the authenticated user
export function generateToken(user: User): string {
  const payload: TokenPayload = { id: user.id, role: user.role };
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

// Validates an incoming token and decodes its payload
export function validateToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as TokenPayload;
    if (!decoded.id) return null;
    return decoded;
  } catch (err) {
    return null;
  }
}

export function revokeToken(token: string): boolean {
  return true;
}
`,
    query: { symbol: 'validateToken' },
    gold: {
      targetLines: ['export function validateToken', 'jwt.verify(token, SECRET)', 'return decoded;'],
      forbiddenLines: ['export function generateToken', 'export function revokeToken'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'ts_method_slice',
    lang: 'typescript',
    file: 'src/router.ts',
    content: `import { IncomingMessage, ServerResponse } from 'http';

export class ApiRouter {
  private routes = new Map<string, Function>();

  public register(path: string, handler: Function): void {
    this.routes.set(path, handler);
  }

  // Handles incoming HTTP request and dispatches to registered route handler
  public handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';
    const handler = this.routes.get(url);
    if (!handler) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    handler(req, res);
  }

  public getRouteCount(): number {
    return this.routes.size;
  }
}
`,
    query: { symbol: 'handleRequest' },
    gold: {
      targetLines: ['public handleRequest', 'res.statusCode = 404', 'handler(req, res);'],
      forbiddenLines: ['public register', 'public getRouteCount'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'ts_file_outline',
    lang: 'typescript',
    file: 'src/utils/format.ts',
    content: `export const DEFAULT_CURRENCY = 'USD';
export const LOCALE = 'en-US';

/**
 * Formats numeric monetary value to standard localized currency string.
 */
export function formatCurrency(amount: number, currency: string = DEFAULT_CURRENCY): string {
  if (isNaN(amount)) throw new TypeError('Amount must be a number');
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(amount);
}

/**
 * Formats Date instance to standard ISO calendar date.
 */
export function formatDate(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }
  return date.toISOString().split('T')[0];
}

/**
 * Truncates text with trailing ellipsis when exceeding length.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export function padZero(num: number, targetLen: number = 2): string {
  return String(num).padStart(targetLen, '0');
}
`,
    query: { outline: true },
    gold: {
      targetLines: ['formatCurrency', 'formatDate', 'truncate', 'padZero'],
      forbiddenLines: ['Intl.NumberFormat', 'toISOString().split', 'padStart(targetLen'],
      expectedKind: 'outline',
    },
  },
  {
    id: 'py_def_slice',
    lang: 'python',
    file: 'services/tax.py',
    content: `TAX_TABLE = {
    "CA": 0.0825,
    "NY": 0.08875,
    "TX": 0.0625,
}

# Calculates total tax for a transaction based on state rates
def calculate_tax(amount: float, state: str) -> float:
    rate = TAX_TABLE.get(state.upper(), 0.0)
    if amount <= 0:
        return 0.0
    return round(amount * rate, 2)

def list_states():
    return list(TAX_TABLE.keys())
`,
    query: { symbol: 'calculate_tax' },
    gold: {
      targetLines: ['def calculate_tax', 'rate = TAX_TABLE.get', 'round(amount * rate, 2)'],
      forbiddenLines: ['def list_states'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'py_class_method_slice',
    lang: 'python',
    file: 'payments/gateway.py',
    content: `class StripeGateway:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.client = None

    # Processes charge against customer token
    def process_charge(self, token: str, amount_cents: int) -> dict:
        if amount_cents <= 0:
            raise ValueError("Amount must be positive")
        charge = {"id": "ch_123", "amount": amount_cents, "status": "succeeded"}
        return charge

    def refund_charge(self, charge_id: str) -> bool:
        return True
`,
    query: { symbol: 'process_charge' },
    gold: {
      targetLines: ['def process_charge', 'raise ValueError', 'charge = {'],
      forbiddenLines: ['def refund_charge', 'def __init__'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'py_file_outline',
    lang: 'python',
    file: 'ml/pipeline.py',
    content: `import os
import sys

class DataPreprocessor:
    def __init__(self, batch_size=32):
        self.batch_size = batch_size

    def clean_text(self, text: str) -> str:
        return text.strip().lower()

def load_dataset(path: str):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing {path}")
    return [{"text": "sample"}]

def train_model(data, epochs=10):
    weights = [0.1] * len(data)
    for _ in range(epochs):
        pass
    return "trained_model"

def evaluate_metrics(model, test_data):
    if not test_data:
        return {"accuracy": 0.0}
    return {"accuracy": 0.95, "f1": 0.94}
`,
    query: { outline: true },
    gold: {
      targetLines: ['DataPreprocessor', 'load_dataset', 'train_model', 'evaluate_metrics'],
      forbiddenLines: ['return {"accuracy": 0.95', 'self.batch_size = batch_size'],
      expectedKind: 'outline',
    },
  },
  {
    id: 'rust_fn_slice',
    lang: 'rust',
    file: 'src/crypto/verifier.rs',
    content: `use sha2::{Sha256, Digest};

pub const HASH_LEN: usize = 32;

/// Verifies cryptographic signature for payload against public key
pub fn verify_signature(payload: &[u8], signature: &[u8], pubkey: &[u8]) -> bool {
    if signature.len() != 64 || pubkey.len() != 32 {
        return false;
    }
    let mut hasher = Sha256::new();
    hasher.update(payload);
    let digest = hasher.finalize();
    digest.len() == HASH_LEN
}

pub fn hash_payload(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}
`,
    query: { symbol: 'verify_signature' },
    gold: {
      targetLines: ['pub fn verify_signature', 'Sha256::new()', 'digest.len() == HASH_LEN'],
      forbiddenLines: ['pub fn hash_payload'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'rust_struct_slice',
    lang: 'rust',
    file: 'src/config.rs',
    content: `#[derive(Debug, Clone, PartialEq)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub max_connections: usize,
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub pool_size: u32,
}
`,
    query: { symbol: 'ServerConfig' },
    gold: {
      targetLines: ['pub struct ServerConfig', 'pub host: String', 'pub port: u16'],
      forbiddenLines: ['pub struct DatabaseConfig'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'go_func_slice',
    lang: 'go',
    file: 'server/server.go',
    content: `package server

import "net/http"

type Config struct {
	Addr string
}

// NewServer initializes http server with provided configuration
func NewServer(cfg Config) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	return &http.Server{
		Addr:    cfg.Addr,
		Handler: mux,
	}
}

func StopServer(s *http.Server) error {
	return s.Close()
}
`,
    query: { symbol: 'NewServer' },
    gold: {
      targetLines: ['func NewServer', 'http.NewServeMux()', 'return &http.Server'],
      forbiddenLines: ['func StopServer'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'go_method_slice',
    lang: 'go',
    file: 'store/kv.go',
    content: `package store

type KVStore struct {
	data map[string]string
}

func (s *KVStore) Get(key string) (string, bool) {
	val, ok := s.data[key]
	return val, ok
}

func (s *KVStore) Set(key string, val string) {
	s.data[key] = val
}
`,
    query: { symbol: 'Get' },
    gold: {
      targetLines: ['func (s *KVStore) Get', 'val, ok := s.data[key]', 'return val, ok'],
      forbiddenLines: ['func (s *KVStore) Set'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'js_async_arrow_slice',
    lang: 'javascript',
    file: 'lib/api.js',
    content: `const BASE_URL = 'https://api.internal';

export const fetchProfile = async (userId) => {
  const res = await fetch(\`\${BASE_URL}/users/\${userId}\`);
  if (!res.ok) throw new Error('user not found');
  return res.json();
};

export const updateProfile = async (userId, data) => {
  return null;
};
`,
    query: { symbol: 'fetchProfile' },
    gold: {
      targetLines: ['export const fetchProfile', 'user not found', 'return res.json();'],
      forbiddenLines: ['export const updateProfile'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'short_file_passthrough',
    lang: 'json',
    file: 'settings.json',
    content: `{
  "port": 8080,
  "env": "production",
  "cors": true
}
`,
    query: {},
    gold: {
      targetLines: ['"port": 8080', '"env": "production"', '"cors": true'],
      forbiddenLines: [],
      expectedKind: 'passthrough',
    },
  },
  {
    id: 'line_range_slice_1',
    lang: 'text',
    file: 'logs/data.txt',
    content: Array.from({ length: 40 }, (_, i) => `record_${i + 1}: metric_value_${(i + 1) * 10}`).join('\n'),
    query: { lines: '12-16' },
    gold: {
      targetLines: ['12: record_12: metric_value_120', '16: record_16: metric_value_160'],
      forbiddenLines: ['11: record_11', '17: record_17'],
      expectedKind: 'lines',
    },
  },
  {
    id: 'line_range_slice_2',
    lang: 'typescript',
    file: 'src/constants.ts',
    content: Array.from({ length: 30 }, (_, i) => `export const CONST_${i + 1} = ${i + 1};`).join('\n'),
    query: { lines: '5-9' },
    gold: {
      targetLines: ['5: export const CONST_5', '9: export const CONST_9'],
      forbiddenLines: ['4: export const CONST_4', '10: export const CONST_10'],
      expectedKind: 'lines',
    },
  },
  {
    id: 'nl_read_question_1',
    lang: 'typescript',
    file: 'src/math.ts',
    content: `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
    question: 'read subtract in src/math.ts',
    gold: {
      targetLines: ['export function subtract', 'return a - b;'],
      forbiddenLines: ['export function add', 'export function multiply'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'nl_read_question_2',
    lang: 'python',
    file: 'utils/auth.py',
    content: `def hash_password(raw_password: str) -> str:
    import hashlib
    return hashlib.sha256(raw_password.encode()).hexdigest()

def verify_password(raw_password: str, hashed: str) -> bool:
    return hash_password(raw_password) == hashed
`,
    question: 'show hash_password in utils/auth.py',
    gold: {
      targetLines: ['def hash_password', 'hashlib.sha256'],
      forbiddenLines: ['def verify_password'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'nl_read_lines',
    lang: 'javascript',
    file: 'routes.js',
    content: Array.from({ length: 50 }, (_, i) => `// route handler ${i + 1}\napp.get('/r${i + 1}', handle${i + 1});`).join('\n'),
    question: 'slice lines 10-15 in routes.js',
    gold: {
      targetLines: ['10:', '15:'],
      forbiddenLines: ['9:', '16:'],
      expectedKind: 'lines',
    },
  },
  {
    id: 'outline_rust_module',
    lang: 'rust',
    file: 'src/parser.rs',
    content: `pub struct ASTNode;

pub enum Token {
    Ident(String),
    Op(char),
    Number(i64),
}

pub fn parse_expression() -> ASTNode {
    ASTNode
}

pub fn parse_statement() -> ASTNode {
    ASTNode
}

pub fn tokenize(input: &str) -> Vec<Token> {
    vec![]
}
`,
    query: { outline: true },
    gold: {
      targetLines: ['ASTNode', 'Token', 'parse_expression', 'parse_statement', 'tokenize'],
      forbiddenLines: ['vec![]'],
      expectedKind: 'outline',
    },
  },
  {
    id: 'large_multi_symbol_ts',
    lang: 'typescript',
    file: 'src/path_utils.ts',
    content: `export function joinPaths(...parts: string[]): string {
  return parts.join('/');
}

// Normalizes path separators and removes redundant dots
export function normalizePath(p: string): string {
  const parts = p.replace(/\\\\/g, '/').split('/');
  const kept: string[] = [];
  for (const part of parts) {
    if (part === '.' || !part) continue;
    if (part === '..') kept.pop();
    else kept.push(part);
  }
  return kept.join('/');
}

export function getFileExt(p: string): string {
  const idx = p.lastIndexOf('.');
  return idx >= 0 ? p.slice(idx) : '';
}
`,
    query: { symbol: 'normalizePath' },
    gold: {
      targetLines: ['export function normalizePath', 'kept.join', 'redundant dots'],
      forbiddenLines: ['export function joinPaths', 'export function getFileExt'],
      expectedKind: 'symbol',
    },
  },
  {
    id: 'outline_python_module',
    lang: 'python',
    file: 'models/user.py',
    content: `class UserRole:
    ADMIN = 'admin'
    MEMBER = 'member'

class UserModel:
    def __init__(self, name: str, role: str):
        self.name = name
        self.role = role

    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN

def get_current_user():
    return UserModel("guest", UserRole.MEMBER)

def list_all_roles():
    return [UserRole.ADMIN, UserRole.MEMBER]
`,
    query: { outline: true },
    gold: {
      targetLines: ['UserRole', 'UserModel', 'get_current_user', 'list_all_roles'],
      forbiddenLines: ['self.name = name', 'return UserModel("guest"'],
      expectedKind: 'outline',
    },
  },
];

mkdirSync(HERE, { recursive: true });
writeFileSync(DEST, JSON.stringify(TASKS, null, 2) + '\n');
console.log(`Wrote ${TASKS.length} tasks to ${DEST}`);
