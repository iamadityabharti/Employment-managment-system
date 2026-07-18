describe('Employee ltree path computation', () => {
  function computePath(managerPath: string | null, employeeNumber: string): string {
    const label = `emp_${employeeNumber.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
    return managerPath ? `${managerPath}.${label}` : 'root';
  }

  it('creates a root path when no manager is provided', () => {
    expect(computePath(null, 'EMP-001')).toBe('root');
  });

  it('appends the employee label to the manager path', () => {
    expect(computePath('root', 'EMP-002')).toBe('root.emp_emp_002');
  });

  it('supports deep nesting', () => {
    expect(computePath('root.emp_002.emp_003', 'EMP-004')).toBe(
      'root.emp_002.emp_003.emp_emp_004'
    );
  });
});

describe('Employee subtree re-path on manager change', () => {
  function rePath(
    oldPath: string,
    newPrefix: string,
    descendantPaths: string[]
  ): string[] {
    return descendantPaths.map((d) => {
      const suffix = d.slice(oldPath.length);
      return `${newPrefix}${suffix}`;
    });
  }

  it('re-paths all descendants when moving a subtree', () => {
    const descendants = [
      'root.emp_002.emp_003.emp_004',
      'root.emp_002.emp_003.emp_005'
    ];
    const result = rePath('root.emp_002.emp_003', 'root.emp_010.emp_003', descendants);
    expect(result).toEqual([
      'root.emp_010.emp_003.emp_004',
      'root.emp_010.emp_003.emp_005'
    ]);
  });

  it('handles moving to root level', () => {
    const descendants = ['a.b.c.d'];
    const result = rePath('a.b.c', 'x', descendants);
    expect(result).toEqual(['x.d']);
  });
});
