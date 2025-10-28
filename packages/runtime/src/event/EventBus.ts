import EventEmitter from 'eventemitter3';
import { filter, map, Observable } from 'rxjs';
import type { BusEvent, EventType } from '../types/index.js';

export class EventBus {
  // 底层 EventEmitter 负责把事件按推送方式广播给订阅者。
  private emitter = new EventEmitter();

  /**
   * 将事件立即广播给所有活跃的订阅者。
   */
  public emit(event: BusEvent): void {
    this.emitter.emit('event', event);
  }

  /**
   * 暴露一个冷 Observable，在订阅时挂接到 EventEmitter，
   * 并在取消订阅时自动移除此监听。
   */
  public events(): Observable<BusEvent> {
    return new Observable<BusEvent>((subscriber) => {
      const handler = (event: BusEvent) => subscriber.next(event);
      this.emitter.on('event', handler);
      return () => {
        this.emitter.off('event', handler);
      };
    });
  }

  /**
   * 便捷方法：只订阅某个特定类型的事件，同时复用同一个 emitter。
   */
  public eventsOfType(type: EventType): Observable<BusEvent> {
    return this.events().pipe(filter((evt) => evt.type === type));
  }

  /**
   * 使用映射函数把原始事件转换成另一种形式，依然保持实时推送。
   */
  public mapEvents<T>(project: (event: BusEvent) => T): Observable<T> {
    return this.events().pipe(map(project));
  }
}
