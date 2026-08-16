// Exact critically-damped spring-damper (closed-form solution at damping
// ratio 1.0 — see Ryan Juckett's "Damped Springs" derivation). Unlike a
// naively Euler-integrated spring, this is unconditionally stable at any dt
// and any stiffness, so it cannot overshoot or blow up even at a low frame
// rate — "no overshoot, no snap" needs to be a real guarantee, not an
// approximation that only happens to look fine at 60fps.
export class Spring1D {
  value: number;
  velocity = 0;

  constructor(initial: number) {
    this.value = initial;
  }

  update(target: number, stiffness: number, dt: number): number {
    const omega = Math.sqrt(stiffness);
    const x0 = this.value - target;
    const c1 = this.velocity + omega * x0;
    const expTerm = Math.exp(-omega * dt);

    this.value = target + (x0 + c1 * dt) * expTerm;
    this.velocity = (this.velocity - omega * c1 * dt) * expTerm;
    return this.value;
  }

  reset(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}
