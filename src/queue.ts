type Job<T> = () => Promise<T>;

interface QueueItem<T> {
  job: Job<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export class BuildQueue {
  private queue: QueueItem<any>[] = [];
  private isProcessing = false;

  /**
   * Adds a deployment or build job to the FIFO queue.
   * Ensures execution is strictly sequential (one at a time) to protect host resources.
   */
  public enqueue<T>(job: Job<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift();
    if (!item) {
      this.isProcessing = false;
      return;
    }

    try {
      const result = await item.job();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.isProcessing = false;
      // Schedule the next job processing asynchronously
      setImmediate(() => this.processNext());
    }
  }

  public getLength(): number {
    return this.queue.length;
  }

  public isBusy(): boolean {
    return this.isProcessing;
  }
}

// Global singleton queue instance for the daemon
export const buildQueue = new BuildQueue();
