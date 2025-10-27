import EventEmitter from 'eventemitter3';
import { filter, map, Observable } from 'rxjs';
import type { BusEvent, EventType } from '../types/index.js';

export class EventBus {
  private emitter = new EventEmitter();

  public emit(event: BusEvent): void {
    this.emitter.emit('event', event);
  }

  public events(): Observable<BusEvent> {
    return new Observable<BusEvent>((subscriber) => {
      const handler = (event: BusEvent) => subscriber.next(event);
      this.emitter.on('event', handler);
      return () => {
        this.emitter.off('event', handler);
      };
    });
  }

  public eventsOfType(type: EventType): Observable<BusEvent> {
    return this.events().pipe(filter((evt) => evt.type === type));
  }

  public mapEvents<T>(project: (event: BusEvent) => T): Observable<T> {
    return this.events().pipe(map(project));
  }
}
