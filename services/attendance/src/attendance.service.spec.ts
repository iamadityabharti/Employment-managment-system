import { validateLeaveTransition, allowedTargets, isTerminalState } from './leave-state-machine';
import type { LeaveState, Role } from '@atlas/contracts';

describe('Leave state machine', () => {
  describe('valid transitions', () => {
    const cases: Array<{ from: LeaveState; to: LeaveState; roles: Role[] }> = [
      { from: 'Pending',       to: 'ManagerReview', roles: ['Manager'] },
      { from: 'Pending',       to: 'ManagerReview', roles: ['Admin'] },
      { from: 'ManagerReview', to: 'HRReview',      roles: ['Manager'] },
      { from: 'HRReview',      to: 'Approved',      roles: ['Admin'] },
      { from: 'HRReview',      to: 'Rejected',      roles: ['Admin'] },
      { from: 'Pending',       to: 'Rejected',      roles: ['Admin'] },
      { from: 'ManagerReview', to: 'Rejected',      roles: ['Admin'] },
    ];

    it.each(cases)('allows $from → $to for $roles', ({ from, to, roles }) => {
      expect(() => validateLeaveTransition(from, to, roles)).not.toThrow();
    });
  });

  describe('invalid transitions', () => {
    it('rejects Pending → Approved (skips ManagerReview and HRReview)', () => {
      expect(() => validateLeaveTransition('Pending', 'Approved', ['Admin'])).toThrow(
        'Invalid transition'
      );
    });

    it('rejects Employee role trying to approve', () => {
      expect(() => validateLeaveTransition('Pending', 'ManagerReview', ['Employee'])).toThrow();
    });

    it('rejects Manager trying to perform final approval', () => {
      expect(() => validateLeaveTransition('HRReview', 'Approved', ['Manager'])).toThrow();
    });
  });

  describe('allowedTargets', () => {
    it('returns valid targets from Pending', () => {
      expect(allowedTargets('Pending')).toEqual(
        expect.arrayContaining(['ManagerReview', 'Rejected'])
      );
    });

    it('returns empty for terminal states', () => {
      expect(allowedTargets('Approved')).toEqual([]);
      expect(allowedTargets('Rejected')).toEqual([]);
    });
  });

  describe('isTerminalState', () => {
    it('Approved and Rejected are terminal', () => {
      expect(isTerminalState('Approved')).toBe(true);
      expect(isTerminalState('Rejected')).toBe(true);
    });

    it('Pending is not terminal', () => {
      expect(isTerminalState('Pending')).toBe(false);
    });
  });
});
