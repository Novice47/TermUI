import { type Style, caps } from '@termuijs/core';
import { Widget } from '../base/Widget.js';

export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface TaskItem {
  id: string | number;
  label: string;
  status: TaskStatus;
}

export interface TaskListOptions {
  pendingText?: string;
  runningText?: string;
  doneText?: string;
  errorText?: string;
  wheelspin?: boolean;
}

const SPINNER_FRAMES_UNICODE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_FRAMES_ASCII = ['-', '\\', '|', '/'];
const SPINNER_INTERVAL = 80;

export class TaskList extends Widget {
  private tasks: TaskItem[] = [];
  private pendingText: string;
  private runningText: string;
  private doneText: string;
  private errorText: string;
  private wheelspin: boolean;

  private frameIndex = 0;
  private elapsed = 0;

  constructor(
    style?: Partial<Style>,
    options: TaskListOptions = {},
    tasks: TaskItem[] = []
  ) {
    super(style);
    this.tasks = tasks;
    this.pendingText = options.pendingText ?? '...';
    this.runningText = options.runningText ?? '...';
    this.doneText = options.doneText ?? '...';
    this.errorText = options.errorText ?? '...';
    this.wheelspin = options.wheelspin ?? false;
  }

  public setTasks(tasks: TaskItem[]): void {
    this.tasks = tasks;
    this.markDirty();
  }

  public tick(dt: number): void {
    if (!this.wheelspin) return;

    const hasRunningTasks = this.tasks.some(t => t.status === 'running');
    if (!hasRunningTasks) return;

    this.elapsed += dt;
    const frames = caps.unicode ? SPINNER_FRAMES_UNICODE : SPINNER_FRAMES_ASCII;
    if (this.elapsed >= SPINNER_INTERVAL) {
      this.frameIndex = (this.frameIndex + 1) % frames.length;
      this.elapsed = 0;
      this.markDirty();
    }
  }

  protected _renderSelf(screen: any): void {
    const { x, y, width, height } = this.rect;
    if (width <= 0 || height <= 0) return;

    this.tasks.forEach((task, index) => {
      if (index >= height) return;

      let indicator = '';
      switch (task.status) {
        case 'pending':
          indicator = this.pendingText;
          break;
        case 'running':
          if (this.wheelspin) {
            const frames = caps.unicode ? SPINNER_FRAMES_UNICODE : SPINNER_FRAMES_ASCII;
            indicator = frames[this.frameIndex % frames.length];
          } else {
            indicator = this.runningText;
          }
          break;
        case 'done':
          indicator = this.doneText;
          break;
        case 'error':
          indicator = this.errorText;
          break;
      }

      const rowText = `${task.label} ${indicator}`;
      const truncatedText = rowText.substring(0, width);

      screen.writeString(x, y + index, truncatedText, this.style as any);
    });
  }
}
