import type {
  CollectionResponse,
  EmployeeSummary,
  LeaveRequest,
  LeaveState,
  LoginInput,
  LoginResponse,
  PayrollProjection,
  PayrollRun,
  SessionUser
} from './types';

export const gatewayUrl = (import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  ''
);

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly traceId?: string;

  constructor(message: string, status: number, body: unknown, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.traceId = traceId;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: Json;
  headers?: HeadersInit;
  skipAuth?: boolean;
  retryOnUnauthorized?: boolean;
  idempotencyKey?: string;
}

let accessTokenProvider: (() => string | null) | undefined;
let tokenRefresh: (() => Promise<string | null>) | undefined;

export function configureApiSession(config: {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
}) {
  accessTokenProvider = config.getAccessToken;
  tokenRefresh = config.refreshAccessToken;
}

function createTraceId() {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function endpoint(path: string) {
  return `${gatewayUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const content = await response.text();
  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function errorMessage(body: unknown, fallback: string) {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string') {
      return record.message;
    }
    if (Array.isArray(record.message)) {
      return record.message.join(', ');
    }
    if (typeof record.error === 'string') {
      return record.error;
    }
  }
  return fallback;
}

async function send<T>(
  path: string,
  options: RequestOptions,
  allowRefresh: boolean,
  traceId: string
): Promise<T> {
  const token = options.skipAuth ? null : accessTokenProvider?.();
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  headers.set('x-trace-id', traceId);

  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (options.idempotencyKey) {
    headers.set('idempotency-key', options.idempotencyKey);
  }
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(endpoint(path), {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include'
  });

  if (
    response.status === 401 &&
    allowRefresh &&
    !options.skipAuth &&
    options.retryOnUnauthorized !== false &&
    tokenRefresh
  ) {
    const refreshed = await tokenRefresh();
    if (refreshed) {
      return send<T>(path, options, false, traceId);
    }
  }

  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(
      errorMessage(body, `Gateway request failed (${response.status})`),
      response.status,
      body,
      response.headers.get('x-trace-id') ?? traceId
    );
  }

  return body as T;
}

export function apiRequest<T>(path: string, options: RequestOptions = {}) {
  return send<T>(path, options, true, createTraceId());
}

function unwrap<T>(response: T | { data?: T }): T {
  if (typeof response === 'object' && response !== null && 'data' in response) {
    const data = (response as { data?: T }).data;
    if (data !== undefined) {
      return data;
    }
  }
  return response as T;
}

function unwrapCollection<T>(response: T[] | CollectionResponse<T>): T[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response.items ?? response.data ?? response.results ?? [];
}

export const authApi = {
  async login(input: LoginInput) {
    return apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: input,
      skipAuth: true,
      retryOnUnauthorized: false
    });
  },
  async refresh() {
    return apiRequest<LoginResponse>('/auth/refresh', {
      method: 'POST',
      skipAuth: true,
      retryOnUnauthorized: false
    });
  },
  async me() {
    return unwrap<SessionUser>(await apiRequest<SessionUser | { data?: SessionUser }>('/auth/me'));
  },
  async logout() {
    await apiRequest<void>('/auth/logout', { method: 'POST', retryOnUnauthorized: false });
  }
};

export const employeesApi = {
  async list() {
    return unwrapCollection<EmployeeSummary>(
      await apiRequest<EmployeeSummary[] | CollectionResponse<EmployeeSummary>>('/employees')
    );
  },
  async reports(employeeId: string) {
    return unwrapCollection<EmployeeSummary>(
      await apiRequest<EmployeeSummary[] | CollectionResponse<EmployeeSummary>>(
        `/employees/${employeeId}/reports`
      )
    );
  },
  async create(input: Omit<EmployeeSummary, 'id' | 'path'>, idempotencyKey: string) {
    return unwrap<EmployeeSummary>(
      await apiRequest<EmployeeSummary | { data?: EmployeeSummary }>('/employees', {
        method: 'POST',
        body: input,
        idempotencyKey
      })
    );
  }
};

export const attendanceApi = {
  async listLeaves() {
    return unwrapCollection<LeaveRequest>(
      await apiRequest<LeaveRequest[] | CollectionResponse<LeaveRequest>>('/attendance/leaves')
    );
  },
  async transition(leaveId: string, to: LeaveState, reason: string | undefined, idempotencyKey: string) {
    return unwrap<LeaveRequest>(
      await apiRequest<LeaveRequest | { data?: LeaveRequest }>(`/attendance/leaves/${leaveId}/transition`, {
        method: 'POST',
        body: { to, reason },
        idempotencyKey
      })
    );
  }
};

export const payrollApi = {
  async listRuns() {
    return unwrapCollection<PayrollRun>(
      await apiRequest<PayrollRun[] | CollectionResponse<PayrollRun>>('/payroll/runs')
    );
  },
  async projection(leaveRequestId: string) {
    return unwrap<PayrollProjection>(
      await apiRequest<PayrollProjection | { data?: PayrollProjection }>(
        `/payroll/projections/${leaveRequestId}`
      )
    );
  },
  async triggerRun(
    input: { employeeId: string; periodStart: string; periodEnd: string },
    idempotencyKey: string
  ) {
    return unwrap<PayrollRun>(
      await apiRequest<PayrollRun | { data?: PayrollRun }>('/payroll/runs', {
        method: 'POST',
        body: input,
        idempotencyKey
      })
    );
  }
};
