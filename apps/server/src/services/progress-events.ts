import { EventEmitter } from 'events';

export interface PipelineEvent {
  stage: string;
  progress: number;
  status: string;
  cutId?: string;
}

class ProgressEventsManager {
  private emitters = new Map<string, EventEmitter>();
  private activeProgress = new Map<string, PipelineEvent>();

  getEmitter(projectId: string): EventEmitter {
    let emitter = this.emitters.get(projectId);
    if (!emitter) {
      emitter = new EventEmitter();
      this.emitters.set(projectId, emitter);
    }
    return emitter;
  }

  emit(projectId: string, event: PipelineEvent) {
    this.activeProgress.set(projectId, event);
    const emitter = this.emitters.get(projectId);
    if (emitter) {
      emitter.emit('progress', event);
    }
  }

  getActiveProgress(projectId: string): PipelineEvent | undefined {
    return this.activeProgress.get(projectId);
  }

  removeEmitter(projectId: string) {
    this.emitters.delete(projectId);
    this.activeProgress.delete(projectId);
  }
}

export const progressEvents = new ProgressEventsManager();
