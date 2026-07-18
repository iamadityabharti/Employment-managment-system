/**
 * k6 load test for the Atlas EMS API Gateway.
 *
 * Scenarios:
 *   1. Health check endpoint (unauthenticated, lightweight)
 *   2. Auth login endpoint (heavier, validates rate limiting)
 *
 * Run:
 *   k6 run load/gateway-health.js
 *
 * Or:
 *   npm run test:load  (with docker-compose stack running)
 *
 * Thresholds:
 *   - p95 response time < 250ms
 *   - Error rate < 1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://localhost:3000';

const errorRate = new Rate('errors');
const healthDuration = new Trend('health_duration', true);

export const options = {
  scenarios: {
    health_check: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '20s', target: 50 },
        { duration: '10s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      exec: 'healthCheck',
    },
    login_flow: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'loginFlow',
      startTime: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<250'],
    errors: ['rate<0.01'],
    health_duration: ['p(95)<100'],
  },
};

export function healthCheck() {
  const start = Date.now();
  const response = http.get(`${GATEWAY_URL}/health/live`);
  healthDuration.add(Date.now() - start);

  const passed = check(response, {
    'health status 200': (r) => r.status === 200,
    'health body ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok';
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!passed);
  sleep(0.1);
}

export function loginFlow() {
  const payload = JSON.stringify({
    email: 'admin@atlas.local',
    password: 'ChangeMe123!',
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const response = http.post(`${GATEWAY_URL}/auth/login`, payload, params);

  const passed = check(response, {
    'login status 200': (r) => r.status === 200,
    'login has token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!body.accessToken;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!passed);
  sleep(1);
}

export default function () {
  healthCheck();
}
