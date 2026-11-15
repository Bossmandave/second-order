/* Dense LU with partial pivoting.
 *
 * Circuits here have fewer than a dozen unknowns, so a sparse solver would be
 * all overhead and no benefit. Partial pivoting is not optional though: an MNA
 * matrix with a voltage source has a zero on its diagonal by construction, and
 * naive Gaussian elimination divides by it on the first pass.
 */

export function solve(A, b) {
  const n = b.length;
  // work on copies: the caller reuses its matrices between timesteps
  const M = A.map((row) => row.slice());
  const x = b.slice();
  const piv = new Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let k = 0; k < n; k++) {
    let max = Math.abs(M[k][k]);
    let row = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k]);
      if (v > max) { max = v; row = i; }
    }
    if (max < 1e-14) return null;          // singular: caller decides what that means
    if (row !== k) {
      const t = M[k]; M[k] = M[row]; M[row] = t;
      const s = x[k]; x[k] = x[row]; x[row] = s;
    }
    const pivot = M[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / pivot;
      if (f === 0) continue;
      M[i][k] = 0;
      for (let j = k + 1; j < n; j++) M[i][j] -= f * M[k][j];
      x[i] -= f * x[k];
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export const zeros = (n) => new Array(n).fill(0);
export const zeroMatrix = (n) =>
  Array.from({ length: n }, () => new Array(n).fill(0));
