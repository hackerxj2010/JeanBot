type Listener<T> = (payload: T) => void | Promise<void>;

export class EventBus<EventMap extends object> {
  private listeners = new Map<keyof EventMap, Set<Listener<EventMap[keyof EventMap]>>>();

  on<Key extends keyof EventMap>(event: Key, listener: Listener<EventMap[Key]>) {
    const bucket =
      this.listeners.get(event) ?? new Set<Listener<EventMap[keyof EventMap]>>();
    bucket.add(listener as Listener<EventMap[keyof EventMap]>);
    this.listeners.set(event, bucket);
  }

  off<Key extends keyof EventMap>(event: Key, listener: Listener<EventMap[Key]>) {
    this.listeners
      .get(event)
      ?.delete(listener as Listener<EventMap[keyof EventMap]>);
  }

  async emit<Key extends keyof EventMap>(event: Key, payload: EventMap[Key]) {
    const bucket = this.listeners.get(event);
    if (!bucket) {
      return;
    }

    for (const listener of bucket as Set<Listener<EventMap[Key]>>) {
      await listener(payload);
    }
  }
}
