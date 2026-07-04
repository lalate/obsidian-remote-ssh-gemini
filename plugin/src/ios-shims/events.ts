/**
 * iOS stub for Node.js 'events' module.
 *
 * Minimal EventEmitter implementation for code paths that
 * use the Node events pattern.
 */

type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  private _events = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const listeners = this._events.get(event) || [];
    listeners.push(listener);
    this._events.set(event, listeners);
    return this;
  }

  addListener(event: string, listener: Listener): this {
    return this.on(event, listener);
  }

  once(event: string, listener: Listener): this {
    const wrapper = (...args: unknown[]) => {
      listener(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this._events.get(event);
    if (!listeners || listeners.length === 0) return false;
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }

  off(event: string, listener: Listener): this {
    const listeners = this._events.get(event);
    if (!listeners) return this;
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
    return this;
  }

  removeListener(event: string, listener: Listener): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }

  listeners(event: string): Listener[] {
    return [...(this._events.get(event) || [])];
  }

  listenerCount(event: string): number {
    return (this._events.get(event) || []).length;
  }

  eventNames(): string[] {
    return [...this._events.keys()];
  }
}

export default { EventEmitter };
