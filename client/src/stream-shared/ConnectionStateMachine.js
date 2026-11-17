export class ConnectionStateMachine {
  constructor(log, config, onChange) {
    this.log = log; this.config = config; this.onChange = onChange;
    this.state = 'idle'; this.target = 'idle'; this.changedAt = Date.now(); this.timer = null;
    this.suppressed = 0; this.recreations = 0; this.transitions = 0;
    this.history = []; this.unhealthySince = null; this.longestUnhealthyMs = 0;
  }
  set(next, reason = '') {
    if (next === this.target && next === this.state) return;
    if (this.target !== this.state && next === this.state) { this.suppressed++; this.log.add('status-flicker-suppressed', { from: this.target, to: next, reason }); }
    this.target = next;
    clearTimeout(this.timer);
    const delay = Math.max(0, (['recovering', 'degraded'].includes(next) ? this.config.reconnectHysteresisMs : 0), this.config.minStatusMs - (Date.now() - this.changedAt));
    if (delay) this.timer = setTimeout(() => this.commit(reason), delay);
    else this.commit(reason);
  }
  commit(reason) {
    this.timer = null;
    if (this.target === this.state) return;
    this.state = this.target; this.changedAt = Date.now(); this.transitions++;
    this.history.push(this.changedAt); this.history = this.history.filter(at => at > Date.now() - 60000);
    if (['degraded', 'recovering'].includes(this.state) && this.unhealthySince == null) this.unhealthySince = this.changedAt;
    if (!['degraded', 'recovering'].includes(this.state) && this.unhealthySince != null) { this.longestUnhealthyMs = Math.max(this.longestUnhealthyMs, this.changedAt - this.unhealthySince); this.unhealthySince = null; }
    this.log.add('status', { state: this.state, reason, suppressed: this.suppressed, recreations: this.recreations });
    this.onChange(this.state);
  }
  dispose() { clearTimeout(this.timer); }
  get transitionsPerMinute() { return this.history.filter(at => at > Date.now() - 60000).length; }
}
