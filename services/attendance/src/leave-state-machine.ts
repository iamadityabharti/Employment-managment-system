import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { LeaveState, Role } from '@atlas/contracts';

/**
 * Explicit state machine for leave approval workflow.
 *
 * Valid transitions:
 *   Pending       → ManagerReview   (Manager, Admin)
 *   ManagerReview → HRReview        (Manager, Admin)
 *   HRReview      → Approved        (Admin)
 *   HRReview      → Rejected        (Admin)
 *   Pending       → Rejected        (Admin)
 *   ManagerReview → Rejected        (Admin)
 *
 * Each transition is validated against the actor's roles.
 * This is the single source of truth for workflow rules.
 */

interface TransitionRule {
  from: LeaveState;
  to: LeaveState;
  allowedRoles: Role[];
}

const TRANSITION_RULES: TransitionRule[] = [
  { from: 'Pending',       to: 'ManagerReview', allowedRoles: ['Manager', 'Admin'] },
  { from: 'ManagerReview', to: 'HRReview',      allowedRoles: ['Manager', 'Admin'] },
  { from: 'HRReview',      to: 'Approved',      allowedRoles: ['Admin'] },
  { from: 'HRReview',      to: 'Rejected',      allowedRoles: ['Admin'] },
  { from: 'Pending',       to: 'Rejected',      allowedRoles: ['Admin'] },
  { from: 'ManagerReview', to: 'Rejected',      allowedRoles: ['Admin'] },
];

export function validateLeaveTransition(
  currentState: LeaveState,
  targetState: LeaveState,
  actorRoles: Role[]
): void {
  const rule = TRANSITION_RULES.find(
    (r) => r.from === currentState && r.to === targetState
  );

  if (!rule) {
    throw new BadRequestException(
      `Invalid transition: ${currentState} → ${targetState}. ` +
      `Allowed targets from ${currentState}: ${allowedTargets(currentState).join(', ') || 'none'}`
    );
  }

  const hasRole = actorRoles.some((role) => rule.allowedRoles.includes(role));
  if (!hasRole) {
    throw new ForbiddenException(
      `Role(s) [${actorRoles.join(', ')}] cannot perform transition ${currentState} → ${targetState}. ` +
      `Required: one of [${rule.allowedRoles.join(', ')}]`
    );
  }
}

export function allowedTargets(from: LeaveState): LeaveState[] {
  return TRANSITION_RULES
    .filter((r) => r.from === from)
    .map((r) => r.to);
}

export function isTerminalState(state: LeaveState): boolean {
  return state === 'Approved' || state === 'Rejected';
}
