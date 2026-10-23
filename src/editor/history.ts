/** Undo/redo over immutable snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    public present: T,
    private limit = 200,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records a new state. Returns false when nothing changed. */
  push(next: T): boolean {
    if (next === this.present) return false;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
    return true;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.present);
    this.present = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.present);
    this.present = next;
    return true;
  }

  reset(value: T): void {
    this.past = [];
    this.future = [];
    this.present = value;
  }
}
